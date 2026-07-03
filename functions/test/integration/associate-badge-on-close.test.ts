// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Covers badge association at checkout close (badge/associate_on_close.ts):
// token doc created with the buyer's userId + the purchase tap's SDM
// counter; never clobbers an existing association; idempotent on re-run;
// removed items associate nothing.

import { expect } from "chai";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { associateBadgesForCheckout } from "../../src/badge/associate_on_close";
import type {
  CheckoutEntity,
  TokenEntity,
} from "../../src/types/firestore_entities";

const TOKEN_ID = "04c339aa1e1890";

async function seedClosedCheckout(opts: {
  checkoutId: string;
  userId: string | null;
  items: Array<Record<string, unknown>>;
}): Promise<{ ref: DocumentReference; checkout: CheckoutEntity }> {
  const db = getFirestore();
  const ref = db.collection("checkouts").doc(opts.checkoutId);
  const checkout = {
    userId: opts.userId ? db.doc(`users/${opts.userId}`) : null,
    status: "closed",
    usageType: "materialbezug",
    created: Timestamp.now(),
    closedAt: Timestamp.now(),
    workshopsVisited: [],
    persons: [],
  } as unknown as CheckoutEntity;
  await ref.set(checkout);
  for (const item of opts.items) {
    await ref.collection("items").add({
      workshop: "diverses",
      description: "Badge",
      origin: "manual",
      catalogId: null,
      created: Timestamp.now(),
      quantity: 1,
      unitPrice: 5,
      totalPrice: 5,
      pricingModel: "direct",
      ...item,
    });
  }
  return { ref, checkout };
}

describe("associateBadgesForCheckout (Integration)", () => {
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

  it("creates the token doc with the buyer's userId and the tap's counter", async () => {
    const { ref, checkout } = await seedClosedCheckout({
      checkoutId: "co-1",
      userId: "buyer-1",
      items: [{ tokenId: TOKEN_ID, badgeSdmCounter: 42 }],
    });

    await associateBadgesForCheckout(ref, checkout);

    const token = await getFirestore().collection("tokens").doc(TOKEN_ID).get();
    expect(token.exists).to.equal(true);
    const data = token.data() as TokenEntity;
    expect(data.userId.id).to.equal("buyer-1");
    expect(data.lastSdmCounter).to.equal(42);
    expect(data.label).to.contain("Selbstkauf");
  });

  it("associates multiple badges from one checkout", async () => {
    const { ref, checkout } = await seedClosedCheckout({
      checkoutId: "co-2",
      userId: "buyer-2",
      items: [
        { tokenId: TOKEN_ID, badgeSdmCounter: 1 },
        { tokenId: "04bbbbbbbbbbbb", badgeSdmCounter: 2 },
        // A regular material item must be ignored.
        { description: "Holz" },
      ],
    });

    await associateBadgesForCheckout(ref, checkout);

    const tokens = await getFirestore().collection("tokens").get();
    expect(tokens.size).to.equal(2);
  });

  it("is idempotent — re-running (trigger retry) changes nothing", async () => {
    const { ref, checkout } = await seedClosedCheckout({
      checkoutId: "co-3",
      userId: "buyer-3",
      items: [{ tokenId: TOKEN_ID, badgeSdmCounter: 5 }],
    });

    await associateBadgesForCheckout(ref, checkout);
    const first = await getFirestore().collection("tokens").doc(TOKEN_ID).get();
    await associateBadgesForCheckout(ref, checkout);
    const second = await getFirestore().collection("tokens").doc(TOKEN_ID).get();

    expect(second.data()).to.deep.equal(first.data());
  });

  it("NEVER clobbers a token registered to another user meanwhile", async () => {
    const db = getFirestore();
    await db.collection("tokens").doc(TOKEN_ID).set({
      userId: db.doc("users/original-owner"),
      registered: Timestamp.now(),
      label: "Admin-registered",
      lastSdmCounter: 99,
    });

    const { ref, checkout } = await seedClosedCheckout({
      checkoutId: "co-4",
      userId: "buyer-4",
      items: [{ tokenId: TOKEN_ID, badgeSdmCounter: 5 }],
    });
    await associateBadgesForCheckout(ref, checkout);

    const token = await db.collection("tokens").doc(TOKEN_ID).get();
    expect((token.data() as TokenEntity).userId.id).to.equal("original-owner");
    expect(token.get("lastSdmCounter")).to.equal(99);
  });

  it("one conflicting badge does not block the others", async () => {
    const db = getFirestore();
    await db.collection("tokens").doc(TOKEN_ID).set({
      userId: db.doc("users/original-owner"),
      registered: Timestamp.now(),
      label: "Taken",
    });

    const { ref, checkout } = await seedClosedCheckout({
      checkoutId: "co-5",
      userId: "buyer-5",
      items: [
        { tokenId: TOKEN_ID, badgeSdmCounter: 1 },
        { tokenId: "04cccccccccccc", badgeSdmCounter: 2 },
      ],
    });
    await associateBadgesForCheckout(ref, checkout);

    const other = await db.collection("tokens").doc("04cccccccccccc").get();
    expect(other.exists).to.equal(true);
    expect((other.data() as TokenEntity).userId.id).to.equal("buyer-5");
  });

  it("does nothing for an open checkout or a null-userId checkout", async () => {
    const db = getFirestore();
    const open = await seedClosedCheckout({
      checkoutId: "co-6",
      userId: "buyer-6",
      items: [{ tokenId: TOKEN_ID, badgeSdmCounter: 1 }],
    });
    await open.ref.update({ status: "open" });
    await associateBadgesForCheckout(open.ref, {
      ...open.checkout,
      status: "open",
    } as CheckoutEntity);
    expect(
      (await db.collection("tokens").doc(TOKEN_ID).get()).exists
    ).to.equal(false);

    const anon = await seedClosedCheckout({
      checkoutId: "co-7",
      userId: null,
      items: [{ tokenId: TOKEN_ID, badgeSdmCounter: 1 }],
    });
    await associateBadgesForCheckout(anon.ref, anon.checkout);
    expect(
      (await db.collection("tokens").doc(TOKEN_ID).get()).exists
    ).to.equal(false);
  });
});
