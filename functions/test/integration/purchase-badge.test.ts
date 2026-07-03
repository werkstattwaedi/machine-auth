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
import { handleAddBadgeToCheckout } from "../../src/badge/purchase";
import { mintBadgeVoucher } from "../../src/badge/voucher";
import type {
  CatalogEntity,
  CheckoutItemEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

const BADGE_CATALOG_ID = "test-badge-catalog";
const MASTER_KEY = "fedcba9876543210fedcba9876543210";
const TOKEN_ID = "04c339aa1e1890";

function voucherFor(tokenId: string, counter = 7): string {
  return mintBadgeVoucher({ tokenId, sdmCounter: counter }, MASTER_KEY);
}

async function seedCatalog() {
  const db = getFirestore();
  const badge: CatalogEntity = {
    code: "BADGE",
    name: "Badge",
    workshops: ["diverses"],
    category: ["Badge"],
    active: true,
    userCanAdd: false,
    variants: [
      {
        id: "standard",
        label: "Badge",
        pricingModel: "direct",
        unitPrice: { default: 5 },
      },
      {
        id: "gratis",
        label: "Badge (gratis)",
        pricingModel: "direct",
        unitPrice: { default: 0 },
      },
    ],
  };
  await db.collection("catalog").doc(BADGE_CATALOG_ID).set(badge);
  await db
    .doc("config/catalog-references")
    .set({ badge: db.collection("catalog").doc(BADGE_CATALOG_ID) });
}

async function seedUser(
  uid: string,
  overrides: Partial<UserEntity> = {}
): Promise<void> {
  const db = getFirestore();
  await db.collection("users").doc(uid).set({
    created: Timestamp.now(),
    email: `${uid}@example.com`,
    firstName: "Test",
    lastName: "User",
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
    ...overrides,
  });
}

/** Kiosk actsAs session caller (badge tap or email-code sign-in). */
function kioskCaller(userId: string) {
  return {
    authUid: `tag:${userId}:nonce`,
    authToken: { tagCheckout: true, actsAs: userId } as Record<string, unknown>,
  };
}

async function itemsOf(checkoutId: string): Promise<CheckoutItemEntity[]> {
  const snap = await getFirestore()
    .collection("checkouts")
    .doc(checkoutId)
    .collection("items")
    .get();
  return snap.docs.map((d) => d.data() as CheckoutItemEntity);
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  messageContains?: string
): Promise<void> {
  try {
    await fn();
    throw new Error(`expected HttpsError code=${expectedCode}, got success`);
  } catch (err: any) {
    expect(err?.code).to.equal(expectedCode);
    if (messageContains) expect(err?.message ?? "").to.contain(messageContains);
  }
}

describe("addBadgeToCheckout (Integration)", () => {
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

  it("member with no tokens: first badge is gratis, checkout created", async () => {
    const db = getFirestore();
    await seedUser("member-1", {
      activeMembership: db.doc("memberships/m1"),
    });

    const res = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("member-1"),
      MASTER_KEY
    );

    expect(res.free).to.equal(true);
    expect(res.unitPrice).to.equal(0);
    expect(res.tokenId).to.equal(TOKEN_ID);
    expect(res.checkoutId).to.be.a("string");

    const checkout = await db
      .collection("checkouts")
      .doc(res.checkoutId!)
      .get();
    expect(checkout.get("status")).to.equal("open");
    expect(checkout.get("usageType")).to.equal("materialbezug");
    expect(checkout.get("userId").id).to.equal("member-1");

    const items = await itemsOf(res.checkoutId!);
    expect(items).to.have.length(1);
    expect(items[0].tokenId).to.equal(TOKEN_ID);
    expect(items[0].badgeSdmCounter).to.equal(7);
    expect(items[0].variantId).to.equal("gratis");
    expect(items[0].totalPrice).to.equal(0);
  });

  it("permission holder (no membership): first badge gratis", async () => {
    const db = getFirestore();
    await seedUser("perm-1", { permissions: [db.doc("permission/laser")] });

    const res = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("perm-1"),
      MASTER_KEY
    );
    expect(res.free).to.equal(true);
  });

  it("no membership, no permission: badge costs the catalog price", async () => {
    await seedUser("plain-1");

    const res = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("plain-1"),
      MASTER_KEY
    );
    expect(res.free).to.equal(false);
    expect(res.unitPrice).to.equal(5);
  });

  it("member who already owns an active token pays for the next badge", async () => {
    const db = getFirestore();
    await seedUser("member-2", { activeMembership: db.doc("memberships/m1") });
    await db.collection("tokens").doc("04aaaaaaaaaaaa").set({
      userId: db.doc("users/member-2"),
      registered: Timestamp.now(),
      label: "First badge",
    });

    const res = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("member-2"),
      MASTER_KEY
    );
    expect(res.free).to.equal(false);
    expect(res.unitPrice).to.equal(5);
  });

  it("a deactivated token does not count against the free first badge", async () => {
    const db = getFirestore();
    await seedUser("member-3", { activeMembership: db.doc("memberships/m1") });
    await db.collection("tokens").doc("04aaaaaaaaaaaa").set({
      userId: db.doc("users/member-3"),
      registered: Timestamp.now(),
      deactivated: Timestamp.now(),
      label: "Lost badge",
    });

    const res = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("member-3"),
      MASTER_KEY
    );
    expect(res.free).to.equal(true);
  });

  it("second badge in the same checkout is standard-priced (buying two at once)", async () => {
    const db = getFirestore();
    await seedUser("member-4", { activeMembership: db.doc("memberships/m1") });

    const first = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("member-4"),
      MASTER_KEY
    );
    expect(first.free).to.equal(true);

    const second = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor("04bbbbbbbbbbbb") },
      kioskCaller("member-4"),
      MASTER_KEY
    );
    expect(second.free).to.equal(false);
    expect(second.unitPrice).to.equal(5);
    expect(second.checkoutId).to.equal(first.checkoutId);

    const items = await itemsOf(first.checkoutId!);
    expect(items).to.have.length(2);
  });

  it("concurrent purchases with no open checkout create exactly ONE checkout", async () => {
    // Race found in code review: with the open-checkout lookup outside the
    // transaction, two concurrent calls could each create a fresh checkout,
    // breaking the one-open-checkout-per-user invariant the wizard relies
    // on. The lookup now lives inside the transaction: the loser retries,
    // sees the winner's checkout, and appends to it.
    const db = getFirestore();
    await seedUser("racer-3", { activeMembership: db.doc("memberships/m1") });

    const [a, b] = await Promise.all([
      handleAddBadgeToCheckout(
        { badgeVoucher: voucherFor(TOKEN_ID) },
        kioskCaller("racer-3"),
        MASTER_KEY
      ),
      handleAddBadgeToCheckout(
        { badgeVoucher: voucherFor("04dddddddddddd") },
        kioskCaller("racer-3"),
        MASTER_KEY
      ),
    ]);

    expect(a.checkoutId).to.equal(b.checkoutId);
    const checkouts = await db
      .collection("checkouts")
      .where("status", "==", "open")
      .get();
    expect(checkouts.size).to.equal(1);
    const items = await itemsOf(a.checkoutId!);
    expect(items).to.have.length(2);
    // Only ONE of the two racing badges may be gratis.
    expect(items.filter((i) => i.totalPrice === 0)).to.have.length(1);
  });

  it("dryRun returns the quote without writing anything", async () => {
    const db = getFirestore();
    await seedUser("member-5", { activeMembership: db.doc("memberships/m1") });

    const quote = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID), dryRun: true },
      kioskCaller("member-5"),
      MASTER_KEY
    );
    expect(quote.free).to.equal(true);
    expect(quote.checkoutId).to.equal(null);

    const checkouts = await db.collection("checkouts").get();
    expect(checkouts.empty).to.equal(true);
  });

  it("rejects the same tokenId twice in one checkout", async () => {
    await seedUser("plain-2");

    await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("plain-2"),
      MASTER_KEY
    );
    await expectHttpsError(
      () =>
        handleAddBadgeToCheckout(
          { badgeVoucher: voucherFor(TOKEN_ID, 8) },
          kioskCaller("plain-2"),
          MASTER_KEY
        ),
      "already-exists",
      "bereits im Checkout"
    );
  });

  it("rejects a badge already registered in tokens/", async () => {
    const db = getFirestore();
    await seedUser("plain-3");
    await db.collection("tokens").doc(TOKEN_ID).set({
      userId: db.doc("users/someone-else"),
      registered: Timestamp.now(),
      label: "Taken",
    });

    await expectHttpsError(
      () =>
        handleAddBadgeToCheckout(
          { badgeVoucher: voucherFor(TOKEN_ID) },
          kioskCaller("plain-3"),
          MASTER_KEY
        ),
      "failed-precondition",
      "bereits registriert"
    );
  });

  it("rejects a badge pending in ANOTHER user's open checkout (race over one badge)", async () => {
    await seedUser("racer-1");
    await seedUser("racer-2");

    await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      kioskCaller("racer-1"),
      MASTER_KEY
    );
    await expectHttpsError(
      () =>
        handleAddBadgeToCheckout(
          { badgeVoucher: voucherFor(TOKEN_ID, 8) },
          kioskCaller("racer-2"),
          MASTER_KEY
        ),
      "failed-precondition",
      "anderen Checkout"
    );
  });

  it("rejects an invalid/expired voucher", async () => {
    await seedUser("plain-4");
    await expectHttpsError(
      () =>
        handleAddBadgeToCheckout(
          { badgeVoucher: "garbage.1.2.3" },
          kioskCaller("plain-4"),
          MASTER_KEY
        ),
      "failed-precondition",
      "erneut auflegen"
    );
  });

  it("rejects unauthenticated and anonymous callers", async () => {
    await expectHttpsError(
      () =>
        handleAddBadgeToCheckout(
          { badgeVoucher: voucherFor(TOKEN_ID) },
          { authUid: undefined, authToken: undefined },
          MASTER_KEY
        ),
      "unauthenticated"
    );
    await expectHttpsError(
      () =>
        handleAddBadgeToCheckout(
          { badgeVoucher: voucherFor(TOKEN_ID) },
          {
            authUid: "anon-uid",
            authToken: {
              firebase: { sign_in_provider: "anonymous" },
            } as Record<string, unknown>,
          },
          MASTER_KEY
        ),
      "permission-denied"
    );
  });

  it("accepts a real (non-kiosk) signed-in caller too", async () => {
    await seedUser("real-1");
    const res = await handleAddBadgeToCheckout(
      { badgeVoucher: voucherFor(TOKEN_ID) },
      {
        authUid: "real-1",
        authToken: {
          firebase: { sign_in_provider: "custom" },
        } as Record<string, unknown>,
      },
      MASTER_KEY
    );
    expect(res.checkoutId).to.be.a("string");
  });
});
