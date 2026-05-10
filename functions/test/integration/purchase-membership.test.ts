// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { handlePurchaseMembership } from "../../src/membership/purchase";
import type {
  CatalogEntity,
  CheckoutEntity,
  CheckoutItemEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

const SINGLE_SKU_ID = "test-cat-mem-single";
const FAMILY_SKU_ID = "test-cat-mem-family";

async function seedCatalog() {
  const db = getFirestore();
  const single: CatalogEntity = {
    code: "MEMBER-SINGLE",
    name: "Mitgliedschaft Einzel (Jahr)",
    workshops: ["diverses"],
    pricingModel: "direct",
    unitPrice: { none: 50, member: 50, intern: 0 },
    active: true,
    userCanAdd: false,
    description: "Single membership.",
    kind: "membership-single",
  };
  const family: CatalogEntity = {
    code: "MEMBER-FAMILY",
    name: "Mitgliedschaft Familie (Jahr)",
    workshops: ["diverses"],
    pricingModel: "direct",
    unitPrice: { none: 70, member: 70, intern: 0 },
    active: true,
    userCanAdd: false,
    description: "Family membership.",
    kind: "membership-family",
  };
  await db.collection("catalog").doc(SINGLE_SKU_ID).set(single);
  await db.collection("catalog").doc(FAMILY_SKU_ID).set(family);
}

async function seedUser(uid: string): Promise<void> {
  const db = getFirestore();
  const user: UserEntity = {
    created: Timestamp.now(),
    email: `${uid}@example.com`,
    firstName: "Test",
    lastName: "User",
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
  };
  await db.collection("users").doc(uid).set(user);
}

function caller(uid: string) {
  return {
    authUid: uid,
    authToken: { admin: false } as Record<string, unknown>,
  };
}

describe("purchaseMembership (Integration)", () => {
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

  it("creates a new materialbezug checkout when the user has no open checkout", async () => {
    await seedUser("buyer-1");

    const res = await handlePurchaseMembership(
      { type: "single" },
      caller("buyer-1"),
    );

    expect(res.unitPrice).to.equal(50);
    expect(res.catalogId).to.equal(SINGLE_SKU_ID);

    const db = getFirestore();
    const checkoutSnap = await db.collection("checkouts").doc(res.checkoutId).get();
    expect(checkoutSnap.exists).to.be.true;
    const checkout = checkoutSnap.data() as CheckoutEntity;
    expect(checkout.usageType).to.equal("materialbezug");
    expect(checkout.status).to.equal("open");
    expect(checkout.workshopsVisited).to.deep.equal([]);
    expect(checkout.persons).to.have.lengthOf(1);
    expect(checkout.persons[0].userType).to.equal("erwachsen");

    const itemsSnap = await checkoutSnap.ref.collection("items").get();
    expect(itemsSnap.size).to.equal(1);
    const item = itemsSnap.docs[0].data() as CheckoutItemEntity;
    expect(item.workshop).to.equal("diverses");
    expect(item.unitPrice).to.equal(50);
    expect(item.totalPrice).to.equal(50);
    expect(item.catalogId?.id).to.equal(SINGLE_SKU_ID);
  });

  it("appends to an existing open checkout instead of creating a new one", async () => {
    await seedUser("buyer-2");

    // Pre-existing visit-style checkout (the very situation that strands the
    // user behind openCheckouts[0] when purchaseMembership creates a parallel
    // doc).
    const db = getFirestore();
    const existingRef = await db.collection("checkouts").add({
      userId: db.collection("users").doc("buyer-2"),
      status: "open",
      usageType: "regular",
      created: Timestamp.now(),
      workshopsVisited: ["holz"],
      persons: [
        {
          name: "Test User",
          email: "buyer-2@example.com",
          userType: "erwachsen",
        },
      ],
      modifiedAt: Timestamp.now(),
      modifiedBy: null,
    } satisfies CheckoutEntity);
    await existingRef.collection("items").add({
      workshop: "holz",
      description: "Some workshop item",
      origin: "manual",
      catalogId: null,
      created: Timestamp.now(),
      quantity: 1,
      unitPrice: 12,
      totalPrice: 12,
    } satisfies CheckoutItemEntity);

    const res = await handlePurchaseMembership(
      { type: "family" },
      caller("buyer-2"),
    );

    // Same checkout — the existing one is reused, no parallel doc.
    expect(res.checkoutId).to.equal(existingRef.id);
    const allCheckouts = await db
      .collection("checkouts")
      .where("userId", "==", db.collection("users").doc("buyer-2"))
      .get();
    expect(allCheckouts.size).to.equal(1);

    const checkout = (await existingRef.get()).data() as CheckoutEntity;
    // Existing usageType / workshopsVisited / persons preserved.
    expect(checkout.usageType).to.equal("regular");
    expect(checkout.workshopsVisited).to.deep.equal(["holz"]);
    expect(checkout.persons).to.have.lengthOf(1);

    // Now contains both the original item and the membership SKU.
    const itemsSnap = await existingRef.collection("items").get();
    expect(itemsSnap.size).to.equal(2);
    const membershipItem = itemsSnap.docs
      .map((d) => d.data() as CheckoutItemEntity)
      .find((i) => i.catalogId?.id === FAMILY_SKU_ID);
    expect(membershipItem).to.exist;
    expect(membershipItem!.workshop).to.equal("diverses");
    expect(membershipItem!.unitPrice).to.equal(70);
  });

  it("refuses when a membership SKU is already in the open checkout", async () => {
    await seedUser("buyer-dup");
    const db = getFirestore();
    // Seed the user's open checkout with a membership SKU already in it
    // (the state we land in after a successful first purchase). The second
    // call must not append a duplicate.
    const existingRef = await db.collection("checkouts").add({
      userId: db.collection("users").doc("buyer-dup"),
      status: "open",
      usageType: "materialbezug",
      created: Timestamp.now(),
      workshopsVisited: [],
      persons: [
        {
          name: "Test User",
          email: "buyer-dup@example.com",
          userType: "erwachsen",
        },
      ],
      modifiedAt: Timestamp.now(),
      modifiedBy: null,
    } satisfies CheckoutEntity);
    await existingRef.collection("items").add({
      workshop: "diverses",
      description: "Mitgliedschaft Einzel (Jahr)",
      origin: "manual",
      catalogId: db.collection("catalog").doc(SINGLE_SKU_ID),
      created: Timestamp.now(),
      quantity: 1,
      unitPrice: 50,
      totalPrice: 50,
    } satisfies CheckoutItemEntity);

    try {
      await handlePurchaseMembership({ type: "single" }, caller("buyer-dup"));
      throw new Error("expected already-exists, got success");
    } catch (err: any) {
      expect(err?.code).to.equal("already-exists");
    }

    // Items count unchanged.
    const itemsSnap = await existingRef.collection("items").get();
    expect(itemsSnap.size).to.equal(1);
  });

  it("refuses when the caller already has an active membership without renewExisting", async () => {
    await seedUser("buyer-3");
    const db = getFirestore();
    // Stamp activeMembership (real ref doesn't matter for the precondition).
    const memRef = db.collection("memberships").doc();
    await db.collection("users").doc("buyer-3").update({ activeMembership: memRef });

    try {
      await handlePurchaseMembership({ type: "single" }, caller("buyer-3"));
      throw new Error("expected failed-precondition, got success");
    } catch (err: any) {
      expect(err?.code).to.equal("failed-precondition");
    }
  });
});
