// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for membership activation via the ack path
 * (`processMembershipForAckedBill` → `applyMembershipPayment`,
 * `functions/src/membership/process_membership_payment.ts`).
 *
 * Issue #323 adds `source: "membership-renewal"` bills. This test proves a
 * renewal-source bill activates (extends an active membership) exactly like
 * a normal checkout bill, and that `pendingRenewalBill` is cleared. Mirrors
 * the emulator-direct pattern used across the integration suite.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import {
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { processMembershipForAckedBill } from "../../src/membership/process_membership_payment";
import type { BillEntity } from "../../src/invoice/types";
import type {
  CatalogEntity,
  CheckoutEntity,
  CheckoutItemEntity,
  MembershipEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

const MEMBERSHIP_CATALOG_ID = "test-membership-catalog";
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedCatalog() {
  const db = getFirestore();
  const membership: CatalogEntity = {
    code: "MEMBERSHIP",
    name: "Mitgliedschaft",
    workshops: ["diverses"],
    category: ["Mitgliedschaft"],
    active: true,
    userCanAdd: false,
    description: "Jahresmitgliedschaft.",
    variants: [
      { id: "single", label: "Einzel", pricingModel: "direct", unitPrice: { default: 50, member: 40 } },
      { id: "family", label: "Familie", pricingModel: "direct", unitPrice: { default: 70, member: 60 } },
    ],
  };
  await db.collection("catalog").doc(MEMBERSHIP_CATALOG_ID).set(membership);
  await db
    .doc("config/catalog-references")
    .set({ membership: db.collection("catalog").doc(MEMBERSHIP_CATALOG_ID) });
}

async function seedActiveMembership(
  uid: string,
  validUntil: Date,
): Promise<{ userRef: DocumentReference; memRef: DocumentReference }> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const user: UserEntity = {
    created: Timestamp.now(),
    email: `${uid}@example.com`,
    firstName: "Test",
    lastName: uid,
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
  };
  await userRef.set(user);
  const memRef = db.collection("memberships").doc();
  const mem: MembershipEntity = {
    type: "single",
    status: "active",
    lastPaidAt: Timestamp.fromMillis(validUntil.getTime() - 365 * DAY_MS),
    validUntil: Timestamp.fromDate(validUntil),
    ownerUserId: userRef,
    members: [userRef],
    paymentCheckouts: [],
    autoRenew: true,
    pendingRenewalBill: null,
    notes: null,
    created: Timestamp.now(),
    modifiedAt: Timestamp.now(),
    modifiedBy: null,
  };
  await memRef.set(mem);
  await userRef.update({ activeMembership: memRef });
  return { userRef, memRef };
}

/**
 * Seed a renewal-source bill with its synthetic closed checkout carrying
 * the membership SKU — the exact shape `runRenewalInvoicer` produces.
 */
async function seedRenewalBill(
  userRef: DocumentReference,
  pendingRenewalBillRefSetter: (billRef: DocumentReference) => Promise<void>,
): Promise<string> {
  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc();
  const billRef = db.collection("bills").doc();
  const now = Timestamp.now();

  const checkout: CheckoutEntity = {
    userId: userRef,
    status: "closed",
    usageType: "materialbezug",
    created: now,
    closedAt: now,
    workshopsVisited: [],
    persons: [
      {
        name: "Test User",
        email: "renew@example.com",
        userType: "erwachsen",
        userRef,
      },
    ],
    paymentMethod: "rechnung",
    billRef,
    modifiedBy: null,
    modifiedAt: now,
  };
  const item: CheckoutItemEntity = {
    workshop: "diverses",
    description: "Mitgliedschaft — Einzel",
    origin: "manual",
    catalogId: db.collection("catalog").doc(MEMBERSHIP_CATALOG_ID),
    variantId: "single",
    pricingModel: "direct",
    created: now,
    quantity: 1,
    unitPrice: 40,
    totalPrice: 40,
  };
  const bill: BillEntity = {
    userId: userRef,
    checkouts: [checkoutRef],
    referenceNumber: 777,
    amount: 40,
    currency: "CHF",
    storagePath: null,
    created: now,
    paidAt: null,
    paidVia: null,
    pdfGeneratedAt: null,
    emailSentAt: null,
    paymentMethodConfirmationTime: Timestamp.now(),
    paymentMethodConfirmationSource: "auto",
    kind: "invoice",
    aggregatedIntoBillRef: null,
    source: "membership-renewal",
  };

  await checkoutRef.set(checkout);
  await checkoutRef.collection("items").doc().set(item);
  await billRef.set(bill);
  await pendingRenewalBillRefSetter(billRef);
  return billRef.id;
}

describe("processMembershipForAckedBill (Integration, #323 renewal source)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    await seedCatalog();
  });

  it("a source: 'membership-renewal' bill extends validUntil and clears pendingRenewalBill", async () => {
    // Anchor relative to the real clock: activation uses `Timestamp.now()`
    // and applies `max(now, validUntil) + 1y`. A hardcoded absolute date
    // eventually drifts behind "now", flipping the branch to restart-from-now
    // and breaking the `before + 365d` assertion (time-bomb). Keep it ahead.
    const validUntil = new Date(Date.now() + 200 * DAY_MS);
    const { userRef, memRef } = await seedActiveMembership("alice", validUntil);
    const before = validUntil.getTime();

    const billId = await seedRenewalBill(userRef, async (billRef) => {
      await memRef.update({ pendingRenewalBill: billRef });
    });

    await processMembershipForAckedBill(billId);

    const mem = (await memRef.get()).data() as MembershipEntity;
    expect(mem.status).to.equal("active");
    expect(mem.validUntil.toMillis()).to.equal(before + 365 * DAY_MS);
    expect(mem.pendingRenewalBill ?? null).to.be.null;
    expect(mem.paymentCheckouts).to.have.length(1);
  });

  it("is idempotent — replaying the same renewal bill does not double-extend", async () => {
    // Anchor relative to the real clock: activation uses `Timestamp.now()`
    // and applies `max(now, validUntil) + 1y`. A hardcoded absolute date
    // eventually drifts behind "now", flipping the branch to restart-from-now
    // and breaking the `before + 365d` assertion (time-bomb). Keep it ahead.
    const validUntil = new Date(Date.now() + 200 * DAY_MS);
    const { userRef, memRef } = await seedActiveMembership("bob", validUntil);
    const before = validUntil.getTime();

    const billId = await seedRenewalBill(userRef, async (billRef) => {
      await memRef.update({ pendingRenewalBill: billRef });
    });

    await processMembershipForAckedBill(billId);
    await processMembershipForAckedBill(billId);

    const mem = (await memRef.get()).data() as MembershipEntity;
    // Still only one year of extension (paymentCheckouts arrayUnion dedup).
    expect(mem.validUntil.toMillis()).to.equal(before + 365 * DAY_MS);
    expect(mem.paymentCheckouts).to.have.length(1);
  });
});
