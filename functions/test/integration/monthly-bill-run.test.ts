// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for the `runMonthlyBillRun` aggregation cron in
 * `functions/src/invoice/monthly_bill_run.ts` (issue #245).
 *
 * Pattern mirrors `acknowledge-bill.test.ts`: invoke the exported helper
 * directly against the Firestore emulator so we don't need the scheduler
 * runtime. PDF generation + email-send paths are stubbed via the same
 * `FUNCTIONS_EMULATOR=true` short-circuit used by trySendEmail, so this
 * test focuses on the Firestore writes only.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { runMonthlyBillRun } from "../../src/invoice/monthly_bill_run";
import type { BillEntity } from "../../src/invoice/types";
import type { CheckoutEntity } from "../../src/types/firestore_entities";

interface SeedOpts {
  userId: string | null;
  billId: string;
  checkoutId: string;
  amount: number;
  /** Bill `created` and checkout `closedAt` Timestamp. */
  createdAt: Date;
  kind?: "invoice" | "beleg";
  aggregatedIntoBillRef?: DocumentReference | null;
  checkoutStatus?: "open" | "closed";
  paymentMethod?: "rechnung" | "twint" | "monthly" | null;
}

async function seed(opts: SeedOpts): Promise<void> {
  const db = getFirestore();
  const userRef = opts.userId ? db.collection("users").doc(opts.userId) : null;
  const billRef = db.collection("bills").doc(opts.billId);
  const checkoutRef = db.collection("checkouts").doc(opts.checkoutId);
  const ts = Timestamp.fromDate(opts.createdAt);

  const checkout: CheckoutEntity = {
    userId: userRef as unknown as FirebaseFirestore.DocumentReference,
    status: opts.checkoutStatus ?? "closed",
    usageType: "regular",
    created: ts,
    workshopsVisited: ["holz"],
    persons: [
      { name: "Test", email: "test@example.com", userType: "erwachsen" },
    ],
    modifiedBy: opts.userId,
    modifiedAt: ts,
    closedAt: ts,
    billRef: billRef,
  };
  if (opts.paymentMethod !== undefined) checkout.paymentMethod = opts.paymentMethod;
  await checkoutRef.set(checkout);

  const bill: BillEntity = {
    userId: userRef as unknown as FirebaseFirestore.DocumentReference,
    checkouts: [checkoutRef],
    referenceNumber: 1,
    amount: opts.amount,
    currency: "CHF",
    storagePath: null,
    created: ts,
    paidAt: null,
    paidVia: null,
    pdfGeneratedAt: null,
    emailSentAt: null,
    paymentMethodConfirmationTime: null,
    paymentMethodConfirmationSource: null,
    kind: opts.kind ?? "invoice",
    aggregatedIntoBillRef: opts.aggregatedIntoBillRef ?? null,
  };
  await billRef.set(bill);
}

async function readBill(billId: string): Promise<BillEntity> {
  const snap = await getFirestore().collection("bills").doc(billId).get();
  return snap.data() as BillEntity;
}

async function listBillsByUser(userId: string): Promise<BillEntity[]> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);
  const snap = await db.collection("bills").where("userId", "==", userRef).get();
  return snap.docs.map((d) => d.data() as BillEntity);
}

describe("runMonthlyBillRun (Integration, #245)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    // Seed the bill-number counter so allocateBill has a base value.
    const db = getFirestore();
    await db.doc("config/billing").set({ nextBillNumber: 100 });
  });

  // 2026-05-15 12:00 UTC = Mai 2026 in Zurich (CEST = UTC+2).
  const inMay = new Date("2026-05-15T12:00:00Z");
  // 2026-04-15 likewise.
  const inApril = new Date("2026-04-15T12:00:00Z");
  // Fire the cron on 2026-06-01 06:00 Zurich — startOfCurrentZurichMonth
  // resolves to 2026-06-01 00:00 Zurich = 2026-05-31 22:00 UTC, so all
  // May Belege are eligible.
  const fireOn = new Date("2026-06-01T04:00:00Z");

  it("aggregates a member's monthly Belege into one kind: invoice bill", async () => {
    await seed({
      userId: "alice",
      billId: "beleg-1",
      checkoutId: "co-1",
      amount: 20,
      createdAt: inMay,
      kind: "beleg",
      paymentMethod: "monthly",
    });
    await seed({
      userId: "alice",
      billId: "beleg-2",
      checkoutId: "co-2",
      amount: 13.5,
      createdAt: new Date("2026-05-20T12:00:00Z"),
      kind: "beleg",
      paymentMethod: "monthly",
    });
    await seed({
      userId: "alice",
      billId: "beleg-3",
      checkoutId: "co-3",
      amount: 7.25,
      createdAt: new Date("2026-05-30T12:00:00Z"),
      kind: "beleg",
      paymentMethod: "monthly",
    });

    const summary = await runMonthlyBillRun(fireOn);

    expect(summary.scannedBelege).to.equal(3);
    expect(summary.groupedUsers).to.equal(1);
    expect(summary.invoicesCreated).to.equal(1);

    const bills = await listBillsByUser("alice");
    // 3 Belege + 1 new invoice
    expect(bills).to.have.length(4);
    const invoice = bills.find((b) => b.kind === "invoice");
    expect(invoice, "aggregated invoice exists").to.exist;
    expect(invoice!.amount).to.equal(40.75);
    expect(invoice!.checkouts).to.have.length(3);
    expect(invoice!.paymentMethodConfirmationTime).to.be.instanceOf(Timestamp);
    expect(invoice!.paymentMethodConfirmationSource).to.equal("auto");
    expect(invoice!.referenceNumber).to.equal(100);

    // Each Beleg now points at the new invoice.
    for (const id of ["beleg-1", "beleg-2", "beleg-3"]) {
      const beleg = await readBill(id);
      expect(beleg.kind).to.equal("beleg");
      expect(beleg.aggregatedIntoBillRef?.id).to.equal(summary.invoiceIds[0]);
    }
  });

  it("leaves a rechnung-acked invoice and an open checkout untouched", async () => {
    await seed({
      userId: "alice",
      billId: "beleg-monthly",
      checkoutId: "co-monthly",
      amount: 10,
      createdAt: inMay,
      kind: "beleg",
      paymentMethod: "monthly",
    });
    await seed({
      userId: "alice",
      billId: "invoice-rechnung",
      checkoutId: "co-rechnung",
      amount: 22,
      createdAt: inMay,
      kind: "invoice",
      paymentMethod: "rechnung",
    });
    await seed({
      userId: "alice",
      billId: "invoice-open",
      checkoutId: "co-open",
      amount: 33,
      createdAt: inMay,
      checkoutStatus: "open",
      kind: "invoice",
    });

    await runMonthlyBillRun(fireOn);

    // The rechnung invoice and the open-checkout bill must not be linked.
    const rechnung = await readBill("invoice-rechnung");
    expect(rechnung.aggregatedIntoBillRef ?? null).to.be.null;
    expect(rechnung.kind).to.equal("invoice");

    const open = await readBill("invoice-open");
    expect(open.aggregatedIntoBillRef ?? null).to.be.null;
    expect(open.kind).to.equal("invoice");

    // The Beleg was the only thing aggregated.
    const beleg = await readBill("beleg-monthly");
    expect(beleg.aggregatedIntoBillRef).to.exist;
  });

  it("groups by user — two members each get their own Sammelrechnung", async () => {
    await seed({
      userId: "alice",
      billId: "alice-1",
      checkoutId: "alice-co-1",
      amount: 10,
      createdAt: inMay,
      kind: "beleg",
      paymentMethod: "monthly",
    });
    await seed({
      userId: "alice",
      billId: "alice-2",
      checkoutId: "alice-co-2",
      amount: 15,
      createdAt: inMay,
      kind: "beleg",
      paymentMethod: "monthly",
    });
    await seed({
      userId: "bob",
      billId: "bob-1",
      checkoutId: "bob-co-1",
      amount: 8,
      createdAt: inMay,
      kind: "beleg",
      paymentMethod: "monthly",
    });

    const summary = await runMonthlyBillRun(fireOn);
    expect(summary.invoicesCreated).to.equal(2);

    const aliceInvoices = (await listBillsByUser("alice")).filter(
      (b) => b.kind === "invoice",
    );
    expect(aliceInvoices).to.have.length(1);
    expect(aliceInvoices[0].amount).to.equal(25);

    const bobInvoices = (await listBillsByUser("bob")).filter(
      (b) => b.kind === "invoice",
    );
    expect(bobInvoices).to.have.length(1);
    expect(bobInvoices[0].amount).to.equal(8);
  });

  it("is idempotent — a second run on the same data creates no new bills", async () => {
    await seed({
      userId: "alice",
      billId: "b-1",
      checkoutId: "co-1",
      amount: 12,
      createdAt: inMay,
      kind: "beleg",
      paymentMethod: "monthly",
    });

    const first = await runMonthlyBillRun(fireOn);
    expect(first.invoicesCreated).to.equal(1);

    const second = await runMonthlyBillRun(fireOn);
    expect(second.invoicesCreated).to.equal(0);
    expect(second.scannedBelege).to.equal(0);

    const bills = await listBillsByUser("alice");
    expect(bills.filter((b) => b.kind === "invoice")).to.have.length(1);
  });

  it("does not aggregate current-month Belege (cutoff is start-of-current-Zurich-month)", async () => {
    // Fire on 2026-05-15 — the cutoff is 2026-05-01 Zurich, so a Beleg
    // created in May is NOT eligible yet (it goes on next month's run).
    const sameMonthFire = new Date("2026-05-15T05:00:00Z");
    await seed({
      userId: "alice",
      billId: "b-same-month",
      checkoutId: "co-same-month",
      amount: 9,
      createdAt: new Date("2026-05-10T12:00:00Z"),
      kind: "beleg",
      paymentMethod: "monthly",
    });
    // An April Beleg IS eligible.
    await seed({
      userId: "alice",
      billId: "b-prior-month",
      checkoutId: "co-prior-month",
      amount: 11,
      createdAt: inApril,
      kind: "beleg",
      paymentMethod: "monthly",
    });

    const summary = await runMonthlyBillRun(sameMonthFire);
    expect(summary.scannedBelege).to.equal(1);

    const same = await readBill("b-same-month");
    expect(same.aggregatedIntoBillRef ?? null).to.be.null;

    const prior = await readBill("b-prior-month");
    expect(prior.aggregatedIntoBillRef).to.exist;
  });

  it("catches up multi-month stragglers — handles a Beleg the previous run missed", async () => {
    // April Beleg never got swept up (1st-of-May run crashed).
    await seed({
      userId: "alice",
      billId: "april-stale",
      checkoutId: "co-april",
      amount: 5,
      createdAt: inApril,
      kind: "beleg",
      paymentMethod: "monthly",
    });
    // Normal May Beleg.
    await seed({
      userId: "alice",
      billId: "may-fresh",
      checkoutId: "co-may",
      amount: 17,
      createdAt: inMay,
      kind: "beleg",
      paymentMethod: "monthly",
    });

    const summary = await runMonthlyBillRun(fireOn);
    // Both swept into the same aggregated bill for Alice.
    expect(summary.invoicesCreated).to.equal(1);

    const invoices = (await listBillsByUser("alice")).filter(
      (b) => b.kind === "invoice",
    );
    expect(invoices[0].amount).to.equal(22);
    expect(invoices[0].checkouts).to.have.length(2);
  });

  it("does nothing when no Belege exist", async () => {
    const summary = await runMonthlyBillRun(fireOn);
    expect(summary).to.deep.equal({
      scannedBelege: 0,
      groupedUsers: 0,
      invoicesCreated: 0,
      invoiceIds: [],
    });
  });
});
