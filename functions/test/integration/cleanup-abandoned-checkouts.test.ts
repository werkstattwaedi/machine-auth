// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for the scheduled
 * `cleanupAbandonedCheckouts` function (issue #151).
 *
 * The Functions emulator is NOT started in this harness — we invoke
 * `runCleanupAbandonedCheckouts` directly against the Firestore
 * emulator so the test is independent of the scheduler runtime.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  ABANDONED_AGE_HOURS,
  runCleanupAbandonedCheckouts,
} from "../../src/checkout/cleanup_abandoned_checkouts";
import type { CheckoutEntity } from "../../src/types/firestore_entities";

const HOUR_MS = 60 * 60 * 1000;

interface SeedOpts {
  status?: "open" | "closed";
  ageHours: number;
  userId?: string | null;
  itemCount?: number;
}

async function seedCheckout(id: string, opts: SeedOpts): Promise<void> {
  const db = getFirestore();
  const created = Timestamp.fromMillis(Date.now() - opts.ageHours * HOUR_MS);
  const userRef =
    opts.userId === undefined
      ? null
      : opts.userId === null
        ? null
        : db.doc(`users/${opts.userId}`);

  const checkout: CheckoutEntity = {
    userId: userRef as CheckoutEntity["userId"],
    status: opts.status ?? "open",
    usageType: "regular",
    created,
    workshopsVisited: ["holz"],
    persons: [],
    modifiedBy: null,
    modifiedAt: created,
  };

  await db.collection("checkouts").doc(id).set(checkout);

  for (let i = 0; i < (opts.itemCount ?? 0); i++) {
    await db
      .collection("checkouts")
      .doc(id)
      .collection("items")
      .doc(`item-${i}`)
      .set({
        workshop: "holz",
        description: `Item ${i}`,
        origin: "manual",
        catalogId: null,
        created,
        quantity: 1,
        unitPrice: 10,
        totalPrice: 10,
      });
  }
}

async function checkoutExists(id: string): Promise<boolean> {
  const snap = await getFirestore().collection("checkouts").doc(id).get();
  return snap.exists;
}

async function itemCount(id: string): Promise<number> {
  const snap = await getFirestore()
    .collection("checkouts")
    .doc(id)
    .collection("items")
    .get();
  return snap.size;
}

describe("cleanupAbandonedCheckouts (Integration)", () => {
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

  it("deletes anonymous open checkouts older than the threshold (with items)", async () => {
    await seedCheckout("co-old-anon", {
      status: "open",
      ageHours: ABANDONED_AGE_HOURS + 1,
      userId: null,
      itemCount: 2,
    });

    const result = await runCleanupAbandonedCheckouts();

    expect(result.deletedCount).to.equal(1);
    expect(result.deletedIds).to.deep.equal(["co-old-anon"]);
    expect(await checkoutExists("co-old-anon")).to.be.false;
    // Items subcollection is gone too.
    expect(await itemCount("co-old-anon")).to.equal(0);
  });

  it("deletes authenticated open checkouts older than the threshold", async () => {
    await seedCheckout("co-old-auth", {
      status: "open",
      ageHours: ABANDONED_AGE_HOURS + 5,
      userId: "alice",
      itemCount: 1,
    });

    const result = await runCleanupAbandonedCheckouts();

    expect(result.deletedCount).to.equal(1);
    expect(result.deletedIds).to.include("co-old-auth");
    expect(await checkoutExists("co-old-auth")).to.be.false;
  });

  it("does NOT delete recent open checkouts (< threshold)", async () => {
    // 1 hour old — well within the 24h reap window.
    await seedCheckout("co-recent", {
      status: "open",
      ageHours: 1,
      userId: null,
    });

    const result = await runCleanupAbandonedCheckouts();
    expect(result.deletedCount).to.equal(0);
    expect(await checkoutExists("co-recent")).to.be.true;
  });

  it("does NOT delete closed checkouts (regardless of age)", async () => {
    // Old + closed → we never reap; closed checkouts are kept for the
    // bill / receipt history.
    await seedCheckout("co-old-closed", {
      status: "closed",
      ageHours: ABANDONED_AGE_HOURS * 30,
      userId: "alice",
      itemCount: 3,
    });

    const result = await runCleanupAbandonedCheckouts();
    expect(result.deletedCount).to.equal(0);
    expect(await checkoutExists("co-old-closed")).to.be.true;
    expect(await itemCount("co-old-closed")).to.equal(3);
  });

  it("processes a mixed batch: deletes only open + old, keeps everything else", async () => {
    await seedCheckout("co-keep-recent-open", {
      status: "open",
      ageHours: 2,
      userId: null,
    });
    await seedCheckout("co-keep-old-closed", {
      status: "closed",
      ageHours: ABANDONED_AGE_HOURS + 10,
      userId: "alice",
    });
    await seedCheckout("co-delete-old-anon", {
      status: "open",
      ageHours: ABANDONED_AGE_HOURS + 0.1,
      userId: null,
      itemCount: 1,
    });
    await seedCheckout("co-delete-old-auth", {
      status: "open",
      ageHours: ABANDONED_AGE_HOURS * 2,
      userId: "bob",
      itemCount: 4,
    });

    const result = await runCleanupAbandonedCheckouts();

    expect(result.deletedCount).to.equal(2);
    expect(result.deletedIds).to.have.members([
      "co-delete-old-anon",
      "co-delete-old-auth",
    ]);

    // Untouched
    expect(await checkoutExists("co-keep-recent-open")).to.be.true;
    expect(await checkoutExists("co-keep-old-closed")).to.be.true;
    // Deleted, items gone
    expect(await checkoutExists("co-delete-old-anon")).to.be.false;
    expect(await checkoutExists("co-delete-old-auth")).to.be.false;
    expect(await itemCount("co-delete-old-anon")).to.equal(0);
    expect(await itemCount("co-delete-old-auth")).to.equal(0);
  });

  it("returns zero count when there are no abandoned checkouts", async () => {
    await seedCheckout("co-fresh", {
      status: "open",
      ageHours: 0.5,
      userId: null,
    });

    const result = await runCleanupAbandonedCheckouts();
    expect(result.deletedCount).to.equal(0);
    expect(result.deletedIds).to.deep.equal([]);
  });

  it("respects an injected `now` for boundary testing", async () => {
    // A checkout that's exactly at the threshold (ABANDONED_AGE_HOURS old)
    // — the comparison is strictly less-than, so a doc at the boundary is
    // NOT deleted.
    const boundary = new Date();
    await seedCheckout("co-boundary", {
      status: "open",
      ageHours: ABANDONED_AGE_HOURS,
      userId: null,
    });

    // Re-seed with an explicit `created` exactly at the cutoff.
    const exactCutoff = Timestamp.fromMillis(
      boundary.getTime() - ABANDONED_AGE_HOURS * HOUR_MS,
    );
    await getFirestore()
      .collection("checkouts")
      .doc("co-boundary")
      .update({ created: exactCutoff });

    const result = await runCleanupAbandonedCheckouts(boundary);
    // `created < cutoff` is strict, so a doc at exactly the boundary stays.
    expect(result.deletedCount).to.equal(0);
    expect(await checkoutExists("co-boundary")).to.be.true;

    // Move the clock forward by 1 ms — now it's strictly less than cutoff.
    const justAfter = new Date(boundary.getTime() + 1);
    const result2 = await runCleanupAbandonedCheckouts(justAfter);
    expect(result2.deletedCount).to.equal(1);
    expect(await checkoutExists("co-boundary")).to.be.false;
  });
});
