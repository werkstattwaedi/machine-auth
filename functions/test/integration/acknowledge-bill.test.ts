// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for the `acknowledgeBill` callable and the
 * `runAutoAcknowledgeBills` cron loop in
 * `functions/src/invoice/acknowledge_bill.ts` (issues #251, #302).
 *
 * The callable is invoked directly via `acknowledgeBill.run()`. We assert
 * the field writes on the bill + linked checkout. The onBillUpdate side-
 * effect chain (email send, membership activation) is covered by the
 * existing bill-processing and process-membership tests.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  acknowledgeBill,
  runAutoAcknowledgeBills,
} from "../../src/invoice/acknowledge_bill";
import type { BillEntity } from "../../src/invoice/types";
import type {
  CheckoutEntity,
  PaymentMethod,
} from "../../src/types/firestore_entities";

interface SeedBillOpts {
  billId: string;
  ownerUid: string | null;
  checkoutId: string;
  amount?: number;
  paidVia?: BillEntity["paidVia"];
  paymentMethod?: PaymentMethod | null;
  createdMsAgo?: number;
}

async function seedBillAndCheckout(opts: SeedBillOpts): Promise<void> {
  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(opts.checkoutId);
  const billRef = db.collection("bills").doc(opts.billId);
  const userRef = opts.ownerUid ? db.collection("users").doc(opts.ownerUid) : null;
  const now = Timestamp.now();
  const created = opts.createdMsAgo
    ? Timestamp.fromMillis(now.toMillis() - opts.createdMsAgo)
    : now;

  const checkout: CheckoutEntity = {
    userId: userRef as unknown as FirebaseFirestore.DocumentReference,
    status: "closed",
    usageType: "regular",
    created,
    workshopsVisited: ["holz"],
    persons: [
      { name: "Alice", email: "alice@example.com", userType: "erwachsen" },
    ],
    modifiedBy: opts.ownerUid,
    modifiedAt: created,
    closedAt: created,
  };
  if (opts.paymentMethod !== undefined) checkout.paymentMethod = opts.paymentMethod;
  await checkoutRef.set(checkout);

  const bill: BillEntity = {
    userId: userRef as unknown as FirebaseFirestore.DocumentReference,
    checkouts: [checkoutRef],
    referenceNumber: 1,
    amount: opts.amount ?? 25.5,
    currency: "CHF",
    storagePath: null,
    created,
    paidAt: opts.paidVia === "free" ? created : null,
    paidVia: opts.paidVia ?? null,
    pdfGeneratedAt: null,
    emailSentAt: null,
    paymentMethodConfirmationTime:
      opts.paidVia === "free" ? created : null,
    paymentMethodConfirmationSource: opts.paidVia === "free" ? "auto" : null,
  };
  await billRef.set(bill);
}

function buildRequest(
  uid: string | null,
  data: Record<string, unknown>,
  opts: { actsAs?: string; anonymous?: boolean; admin?: boolean } = {},
): CallableRequest<unknown> {
  const auth =
    uid != null
      ? {
          uid,
          token: {
            ...(opts.actsAs ? { actsAs: opts.actsAs } : {}),
            ...(opts.admin ? { admin: true } : {}),
            ...(opts.anonymous
              ? { firebase: { sign_in_provider: "anonymous" } }
              : {}),
          },
        }
      : undefined;
  return {
    data,
    auth,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

async function call(
  uid: string | null,
  data: Record<string, unknown>,
  opts: { actsAs?: string; anonymous?: boolean; admin?: boolean } = {},
): ReturnType<typeof acknowledgeBill.run> {
  return acknowledgeBill.run(
    buildRequest(uid, data, opts) as unknown as Parameters<
      typeof acknowledgeBill.run
    >[0],
  );
}

async function readBill(billId: string): Promise<BillEntity> {
  const db = getFirestore();
  const snap = await db.collection("bills").doc(billId).get();
  return snap.data() as BillEntity;
}

async function readCheckout(checkoutId: string): Promise<CheckoutEntity> {
  const db = getFirestore();
  const snap = await db.collection("checkouts").doc(checkoutId).get();
  return snap.data() as CheckoutEntity;
}

describe("acknowledgeBill callable (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
  });

  it("stamps confirmation fields on the bill and paymentMethod on the checkout (owner)", async () => {
    await seedBillAndCheckout({
      billId: "b1",
      ownerUid: "alice",
      checkoutId: "co1",
    });

    const res = await call("alice", { billId: "b1", paymentMethod: "rechnung" });
    expect(res).to.deep.equal({ ok: true });

    const bill = await readBill("b1");
    expect(bill.paymentMethodConfirmationTime).to.be.instanceOf(Timestamp);
    expect(bill.paymentMethodConfirmationSource).to.equal("user");

    const checkout = await readCheckout("co1");
    expect(checkout.paymentMethod).to.equal("rechnung");
  });

  it("is idempotent — second call returns ok and does not rewrite the timestamp", async () => {
    await seedBillAndCheckout({
      billId: "b1",
      ownerUid: "alice",
      checkoutId: "co1",
    });

    await call("alice", { billId: "b1", paymentMethod: "rechnung" });
    const firstAck = (await readBill("b1")).paymentMethodConfirmationTime;
    // Tiny delay so a second write would be observably newer.
    await new Promise((r) => setTimeout(r, 25));
    await call("alice", { billId: "b1", paymentMethod: "twint" });

    const bill = await readBill("b1");
    expect(bill.paymentMethodConfirmationTime?.toMillis()).to.equal(
      firstAck?.toMillis(),
    );
  });

  it("denies a non-owner caller (cross-user)", async () => {
    await seedBillAndCheckout({
      billId: "b1",
      ownerUid: "alice",
      checkoutId: "co1",
    });
    try {
      await call("bob", { billId: "b1", paymentMethod: "rechnung" });
      throw new Error("Expected permission-denied");
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).to.equal("permission-denied");
    }
  });

  it("allows a tag-tap session (actsAs claim) to ack on behalf of the owner", async () => {
    await seedBillAndCheckout({
      billId: "b1",
      ownerUid: "alice",
      checkoutId: "co1",
    });

    await call("tag:abc", {
      billId: "b1",
      paymentMethod: "rechnung",
    }, { actsAs: "alice" });

    const bill = await readBill("b1");
    expect(bill.paymentMethodConfirmationSource).to.equal("user");
  });

  it("allows an admin to ack any bill", async () => {
    await seedBillAndCheckout({
      billId: "b1",
      ownerUid: "alice",
      checkoutId: "co1",
    });

    await call("admin", { billId: "b1", paymentMethod: "rechnung" }, {
      admin: true,
    });

    const bill = await readBill("b1");
    expect(bill.paymentMethodConfirmationSource).to.equal("user");
  });

  it("rejects an invalid paymentMethod", async () => {
    await seedBillAndCheckout({
      billId: "b1",
      ownerUid: "alice",
      checkoutId: "co1",
    });
    try {
      await call("alice", { billId: "b1", paymentMethod: "bitcoin" });
      throw new Error("Expected invalid-argument");
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).to.equal("invalid-argument");
    }
  });

  // Sammelrechnung path (issue #245): picking monthly flips the per-visit
  // bill to a Beleg rather than acking it. The monthly aggregation cron
  // is the customer-of-record commitment, not this callable.
  it("flips bill to kind 'beleg' on paymentMethod 'monthly' (no ack-time)", async () => {
    await seedBillAndCheckout({
      billId: "b-monthly",
      ownerUid: "alice",
      checkoutId: "co-monthly",
    });

    const res = await call("alice", {
      billId: "b-monthly",
      paymentMethod: "monthly",
    });
    expect(res).to.deep.equal({ ok: true });

    const bill = await readBill("b-monthly");
    expect(bill.kind).to.equal("beleg");
    expect(bill.paymentMethodConfirmationTime).to.be.null;
    expect(bill.paymentMethodConfirmationSource).to.be.null;

    const checkout = await readCheckout("co-monthly");
    expect(checkout.paymentMethod).to.equal("monthly");
  });

  it("is idempotent on a bill already flipped to 'beleg' (double-click)", async () => {
    await seedBillAndCheckout({
      billId: "b-beleg-idem",
      ownerUid: "alice",
      checkoutId: "co-beleg-idem",
    });

    await call("alice", { billId: "b-beleg-idem", paymentMethod: "monthly" });
    const first = await readBill("b-beleg-idem");
    expect(first.kind).to.equal("beleg");

    // Second click with a different method must not corrupt the Beleg
    // — once a doc is a Beleg it stays a Beleg until the cron sweeps it up.
    const res = await call("alice", {
      billId: "b-beleg-idem",
      paymentMethod: "rechnung",
    });
    expect(res).to.deep.equal({ ok: true });

    const second = await readBill("b-beleg-idem");
    expect(second.kind).to.equal("beleg");
    expect(second.paymentMethodConfirmationTime).to.be.null;
  });
});

describe("runAutoAcknowledgeBills cron (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
  });

  it("auto-acks bills older than the window with source 'auto'", async () => {
    await seedBillAndCheckout({
      billId: "b-stale",
      ownerUid: "alice",
      checkoutId: "co-stale",
      createdMsAgo: 90 * 60 * 1000, // 90 min old → past the 1h default window
    });

    const res = await runAutoAcknowledgeBills(new Date());
    expect(res.ackedIds).to.deep.equal(["b-stale"]);

    const bill = await readBill("b-stale");
    expect(bill.paymentMethodConfirmationSource).to.equal("auto");
  });

  it("leaves fresh bills (< window) untouched", async () => {
    await seedBillAndCheckout({
      billId: "b-fresh",
      ownerUid: "alice",
      checkoutId: "co-fresh",
      createdMsAgo: 10 * 60 * 1000, // 10 min
    });

    const res = await runAutoAcknowledgeBills(new Date());
    expect(res.ackedIds).to.deep.equal([]);

    const bill = await readBill("b-fresh");
    expect(bill.paymentMethodConfirmationTime).to.be.null;
  });

  it("skips bills that are already acked", async () => {
    await seedBillAndCheckout({
      billId: "b-already",
      ownerUid: "alice",
      checkoutId: "co-already",
      createdMsAgo: 90 * 60 * 1000,
    });
    // Pre-ack
    const db = getFirestore();
    await db.collection("bills").doc("b-already").update({
      paymentMethodConfirmationTime: Timestamp.now(),
      paymentMethodConfirmationSource: "user",
    });

    const res = await runAutoAcknowledgeBills(new Date());
    expect(res.ackedIds).to.deep.equal([]);

    const bill = await readBill("b-already");
    expect(bill.paymentMethodConfirmationSource).to.equal("user"); // unchanged
  });

  it("skips free bills (defensive — they're pre-acked at creation)", async () => {
    // Free bills are pre-acked in allocateBill, so the query filter
    // (paymentMethodConfirmationTime == null) naturally excludes them.
    // This test asserts that even if a free bill somehow slipped through
    // with null ack-time, the cron skips it via the paidVia gate.
    await seedBillAndCheckout({
      billId: "b-free",
      ownerUid: "alice",
      checkoutId: "co-free",
      createdMsAgo: 90 * 60 * 1000,
    });
    const db = getFirestore();
    // Force the malformed state: free + no ack-time.
    await db.collection("bills").doc("b-free").update({
      paidVia: "free",
      paidAt: Timestamp.now(),
      paymentMethodConfirmationTime: null,
    });

    const res = await runAutoAcknowledgeBills(new Date());
    expect(res.ackedIds).to.deep.equal([]);
  });

  it("writes paymentMethod='rechnung' on the checkout when it was previously null", async () => {
    await seedBillAndCheckout({
      billId: "b-default-method",
      ownerUid: "alice",
      checkoutId: "co-default-method",
      createdMsAgo: 90 * 60 * 1000,
    });

    await runAutoAcknowledgeBills(new Date());

    const checkout = await readCheckout("co-default-method");
    expect(checkout.paymentMethod).to.equal("rechnung");
  });

  it("does NOT overwrite an existing checkout.paymentMethod (user already picked)", async () => {
    await seedBillAndCheckout({
      billId: "b-twint-pick",
      ownerUid: "alice",
      checkoutId: "co-twint-pick",
      createdMsAgo: 90 * 60 * 1000,
      paymentMethod: "twint",
    });

    await runAutoAcknowledgeBills(new Date());

    const checkout = await readCheckout("co-twint-pick");
    expect(checkout.paymentMethod).to.equal("twint");
  });

  // Sammelrechnung path (issue #245): a member who picked the monthly
  // tab on Step 4 but walked out without committing. Symmetric with the
  // user-ack-for-monthly callable transition — flip to Beleg, don't
  // email a per-visit invoice. The monthly cron picks these up.
  it("flips bill to kind 'beleg' when checkout.paymentMethod is 'monthly' (no ack-time)", async () => {
    await seedBillAndCheckout({
      billId: "b-monthly-walkout",
      ownerUid: "alice",
      checkoutId: "co-monthly-walkout",
      createdMsAgo: 90 * 60 * 1000,
      paymentMethod: "monthly",
    });

    const res = await runAutoAcknowledgeBills(new Date());
    expect(res.ackedIds).to.deep.equal([]);
    expect(res.belegFlippedIds).to.deep.equal(["b-monthly-walkout"]);

    const bill = await readBill("b-monthly-walkout");
    expect(bill.kind).to.equal("beleg");
    expect(bill.paymentMethodConfirmationTime).to.be.null;
    expect(bill.paymentMethodConfirmationSource).to.be.null;
  });

  it("skips bills already flipped to kind 'beleg' (defensive — query filter would too)", async () => {
    await seedBillAndCheckout({
      billId: "b-beleg-existing",
      ownerUid: "alice",
      checkoutId: "co-beleg-existing",
      createdMsAgo: 90 * 60 * 1000,
      paymentMethod: "monthly",
    });
    const db = getFirestore();
    await db.collection("bills").doc("b-beleg-existing").update({ kind: "beleg" });

    const res = await runAutoAcknowledgeBills(new Date());
    expect(res.ackedIds).to.deep.equal([]);
    expect(res.belegFlippedIds).to.deep.equal([]);

    const bill = await readBill("b-beleg-existing");
    expect(bill.kind).to.equal("beleg");
    expect(bill.paymentMethodConfirmationTime).to.be.null;
  });
});
