// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for the `adminMarkBillsPaid` callable
 * (functions/src/invoice/mark_bills_paid.ts) — the single write path for
 * booking payments from the admin Rechnungen workspace / statement import.
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
import { adminMarkBillsPaidHandler } from "../../src/invoice/mark_bills_paid";
import type { BillEntity } from "../../src/invoice/types";

async function seedBill(
  billId: string,
  opts: { paidAt?: Timestamp | null; kind?: "invoice" | "beleg" } = {},
): Promise<void> {
  const db = getFirestore();
  const bill: Partial<BillEntity> = {
    userId: db.collection("users").doc("u1") as never,
    checkouts: [],
    referenceNumber: 42,
    amount: 84,
    currency: "CHF",
    storagePath: null,
    created: Timestamp.now(),
    paidAt: opts.paidAt ?? null,
    paidVia: opts.paidAt ? "twint" : null,
    ...(opts.kind ? { kind: opts.kind } : {}),
  };
  await db.collection("bills").doc(billId).set(bill);
}

function adminRequest(data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: "admin1", token: { admin: true } },
  } as unknown as CallableRequest<unknown>;
}

describe("adminMarkBillsPaid (integration)", function () {
  this.timeout(20000);

  before(async () => {
    await setupEmulator();
  });
  beforeEach(async () => {
    await clearFirestore();
  });
  after(async () => {
    await teardownEmulator();
  });

  it("requires the admin claim", async () => {
    const request = {
      data: { bills: [{ billId: "b1", paidVia: "cash" }] },
      auth: { uid: "user1", token: {} },
    } as unknown as CallableRequest<unknown>;
    try {
      await adminMarkBillsPaidHandler(request);
      expect.fail("should have thrown");
    } catch (err) {
      expect(String(err)).to.contain("Admin access required");
    }
  });

  it("books unpaid invoices with the given channel and value date", async () => {
    await seedBill("b1");
    const paidAtMs = Date.parse("2026-06-28T00:00:00Z");
    const result = await adminMarkBillsPaidHandler(
      adminRequest({ bills: [{ billId: "b1", paidVia: "ebanking", paidAtMs }] }),
    );
    expect(result).to.deep.include({ paid: 1 });
    const snap = await getFirestore().doc("bills/b1").get();
    const bill = snap.data() as BillEntity;
    expect(bill.paidVia).to.equal("ebanking");
    expect(bill.paidAt?.toMillis()).to.equal(paidAtMs);
  });

  it("skips already-paid bills and rejects Belege / unknown ids", async () => {
    await seedBill("paid1", { paidAt: Timestamp.now() });
    await seedBill("beleg1", { kind: "beleg" });
    await seedBill("open1");
    const result = await adminMarkBillsPaidHandler(
      adminRequest({
        bills: [
          { billId: "paid1", paidVia: "cash" },
          { billId: "beleg1", paidVia: "cash" },
          { billId: "missing", paidVia: "cash" },
          { billId: "open1", paidVia: "cash" },
        ],
      }),
    );
    expect(result.paid).to.equal(1);
    expect(result.alreadyPaid).to.deep.equal(["paid1"]);
    expect(result.rejected).to.have.members(["beleg1", "missing"]);

    // The already-paid bill keeps its original channel.
    const paidSnap = await getFirestore().doc("bills/paid1").get();
    expect((paidSnap.data() as BillEntity).paidVia).to.equal("twint");
  });
});
