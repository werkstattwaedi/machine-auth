// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Sequential bill numbering in `allocateBill`
 * (`functions/src/invoice/create_bill.ts`), against the Firestore emulator
 * so the real transaction runs. Every path that mints an original bill goes
 * through it (issue #158; ADR-0042 for the `× 10` layout).
 */

import { expect } from "chai";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { allocateBill } from "../../src/invoice/create_bill";
import type { BillEntity } from "../../src/invoice/types";

async function seedBillingConfig(nextBillNumber: number): Promise<void> {
  await getFirestore().doc("config/billing").set({
    nextBillNumber,
    // ADR-0042: allocateBill refuses to mint against an existing config doc
    // without the migrated-format marker.
    referenceNumberFormat: "shifted-v1",
  });
}

async function getBillingConfigNext(): Promise<number | null> {
  const snap = await getFirestore().doc("config/billing").get();
  if (!snap.exists) return null;
  return (snap.data()?.nextBillNumber as number) ?? null;
}

/** Mints one CHF 10 bill for `checkoutId` and returns its stored doc. */
async function mintBill(checkoutId: string): Promise<BillEntity> {
  const db = getFirestore();
  const billRef = db.collection("bills").doc();
  await db.runTransaction(async (tx) => {
    await allocateBill(tx, db, {
      userId: null,
      checkoutRefs: [db.collection("checkouts").doc(checkoutId)],
      amount: 10,
      billRef,
    });
  });
  return (await billRef.get()).data() as BillEntity;
}

describe("allocateBill numbering (Integration)", () => {
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

  it("allocates sequential numbers from config/billing.nextBillNumber with no gaps", async () => {
    await seedBillingConfig(42);

    const allocated: number[] = [];
    for (const id of ["co-a", "co-b", "co-c"]) {
      allocated.push((await mintBill(id)).referenceNumber);
    }

    // Stored numbers are counter × 10 (revision digit 0, ADR-0042); the
    // counter itself still advances by 1.
    expect(allocated).to.deep.equal([420, 430, 440]);
    expect(await getBillingConfigNext()).to.equal(45);
  });

  it("bootstraps numbering at 1 when config/billing does not exist", async () => {
    const db = getFirestore();
    expect((await db.doc("config/billing").get()).exists).to.be.false;

    const bill = await mintBill("co-first");

    expect(bill.referenceNumber).to.equal(10);
    expect(await getBillingConfigNext()).to.equal(2);
    // A fresh install bootstraps with the migrated-format marker set.
    const cfg = await db.doc("config/billing").get();
    expect(cfg.data()?.referenceNumberFormat).to.equal("shifted-v1");
  });

  it("refuses to mint against an existing config/billing without the format marker (ADR-0042)", async () => {
    // Un-migrated data: the counter exists but the ×10 migration never ran.
    const db = getFirestore();
    await db.doc("config/billing").set({ nextBillNumber: 42 });

    let thrown: unknown = null;
    try {
      await mintBill("co-unmigrated");
    } catch (err) {
      thrown = err;
    }
    expect(thrown, "allocateBill must throw").to.not.be.null;
    expect((thrown as { code?: string }).code).to.equal("failed-precondition");
    expect((await db.collection("bills").get()).empty).to.be.true;
    expect(await getBillingConfigNext(), "counter untouched").to.equal(42);
  });
});
