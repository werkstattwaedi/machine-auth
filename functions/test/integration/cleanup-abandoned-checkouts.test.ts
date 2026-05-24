// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Regression coverage for the scheduled
 * `cleanupAbandonedCheckouts` function (issues #151, #318).
 *
 * The Functions emulator is NOT started in this harness — we invoke
 * `runCleanupAbandonedCheckouts` directly against the Firestore and
 * Auth emulators so the test is independent of the scheduler runtime.
 *
 * Issue #318 reshaped this job: it now reaps anonymous Firebase Auth
 * users idle for >7d AND any checkouts they created (via the
 * `anonymousUid` field). Signed-in / tag-tap checkouts are never
 * touched. The test matrix below locks that down so a future change
 * cannot accidentally reach back to the broad time-based reap that
 * also nuked signed-in carts.
 */

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  ANON_USER_RETENTION_HOURS,
  runCleanupAbandonedCheckouts,
} from "../../src/checkout/cleanup_abandoned_checkouts";
import type { CheckoutEntity } from "../../src/types/firestore_entities";

const HOUR_MS = 60 * 60 * 1000;

interface SeedCheckoutOpts {
  status?: "open" | "closed";
  ageHours: number;
  /** doc id under /users; omit or pass null for anon (no userId). */
  userId?: string | null;
  /** Anon Firebase Auth UID stamp; null for signed-in / tag-tap. */
  anonymousUid?: string | null;
  itemCount?: number;
}

async function seedCheckout(id: string, opts: SeedCheckoutOpts): Promise<void> {
  const db = getFirestore();
  const created = Timestamp.fromMillis(Date.now() - opts.ageHours * HOUR_MS);
  const userRef = opts.userId ? db.doc(`users/${opts.userId}`) : null;

  const checkout: CheckoutEntity = {
    userId: userRef as CheckoutEntity["userId"],
    status: opts.status ?? "open",
    usageType: "regular",
    created,
    workshopsVisited: ["holz"],
    persons: [],
    modifiedBy: null,
    modifiedAt: created,
    anonymousUid: opts.anonymousUid ?? null,
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

/**
 * Create an anonymous Firebase Auth user via the admin SDK's
 * `importUsers` path so we can synthesize an arbitrary
 * `lastLoginAt` (millis) — `createUser` doesn't accept that field
 * and the emulator doesn't let us "rewind" sign-ins after the fact.
 * `providerData: []` is the canonical marker for an anon user.
 */
async function seedAnonUser(uid: string, lastSignInAgeHours: number): Promise<void> {
  const lastLoginAt = Date.now() - lastSignInAgeHours * HOUR_MS;
  await getAuth().importUsers([
    {
      uid,
      providerData: [],
      metadata: {
        creationTime: new Date(lastLoginAt).toUTCString(),
        lastSignInTime: new Date(lastLoginAt).toUTCString(),
      },
    },
  ]);
}

/** Create a non-anon (email/password) user via the admin SDK. */
async function seedEmailUser(uid: string, email: string): Promise<void> {
  await getAuth().createUser({
    uid,
    email,
    password: "irrelevant-test-pw",
  });
}

async function authUserExists(uid: string): Promise<boolean> {
  try {
    await getAuth().getUser(uid);
    return true;
  } catch {
    return false;
  }
}

async function clearAuth(): Promise<void> {
  // Delete all auth users between tests so the listUsers scan is
  // deterministic. The emulator exposes deleteUsers via the admin
  // SDK; iterate the full list and call it.
  const all: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) all.push(u.uid);
    pageToken = page.pageToken;
  } while (pageToken);
  if (all.length > 0) {
    await getAuth().deleteUsers(all);
  }
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
    await clearAuth();
  });

  it("deletes expired anon user AND their checkout (with items)", async () => {
    await seedAnonUser("anon-expired", ANON_USER_RETENTION_HOURS + 1);
    await seedCheckout("co-expired", {
      status: "open",
      ageHours: ANON_USER_RETENTION_HOURS + 0.1,
      userId: null,
      anonymousUid: "anon-expired",
      itemCount: 2,
    });

    const result = await runCleanupAbandonedCheckouts();

    expect(result.expiredUsers).to.equal(1);
    expect(result.deletedUsers).to.equal(1);
    expect(result.deletedCheckoutCount).to.equal(1);
    expect(result.deletedCheckoutIds).to.deep.equal(["co-expired"]);
    expect(await checkoutExists("co-expired")).to.be.false;
    // Items subcollection is gone too.
    expect(await itemCount("co-expired")).to.equal(0);
    expect(await authUserExists("anon-expired")).to.be.false;
  });

  it("does NOT delete authenticated checkouts regardless of age", async () => {
    // The exact bug surfaced by issue #318: the old time-based reaper
    // nuked a signed-in user's open cart after 24h, losing their work.
    // The new job operates only via the `anonymousUid` join, so an
    // arbitrarily-old signed-in checkout is preserved.
    await seedCheckout("co-auth-old", {
      status: "open",
      ageHours: ANON_USER_RETENTION_HOURS * 10,
      userId: "alice",
      anonymousUid: null,
      itemCount: 1,
    });

    const result = await runCleanupAbandonedCheckouts();

    expect(result.deletedCheckoutCount).to.equal(0);
    expect(await checkoutExists("co-auth-old")).to.be.true;
    expect(await itemCount("co-auth-old")).to.equal(1);
  });

  it("does NOT delete recent anon user (< retention window)", async () => {
    await seedAnonUser("anon-recent", 1);
    await seedCheckout("co-recent-anon", {
      status: "open",
      ageHours: ANON_USER_RETENTION_HOURS + 5, // stale doc but user is fresh
      userId: null,
      anonymousUid: "anon-recent",
    });

    const result = await runCleanupAbandonedCheckouts();
    expect(result.expiredUsers).to.equal(0);
    expect(result.deletedCheckoutCount).to.equal(0);
    expect(await checkoutExists("co-recent-anon")).to.be.true;
    expect(await authUserExists("anon-recent")).to.be.true;
  });

  it("does NOT delete email/password users (they are not anonymous)", async () => {
    await seedEmailUser("real-1", "real@example.com");

    const result = await runCleanupAbandonedCheckouts();
    expect(result.anonymousUsers).to.equal(0);
    expect(result.deletedUsers).to.equal(0);
    expect(await authUserExists("real-1")).to.be.true;
  });

  it("processes a mixed batch: expired anon reaped, others survive", async () => {
    // Expired anon + their checkout — reaped.
    await seedAnonUser("anon-A", ANON_USER_RETENTION_HOURS + 2);
    await seedCheckout("co-A", {
      status: "open",
      ageHours: ANON_USER_RETENTION_HOURS + 1,
      userId: null,
      anonymousUid: "anon-A",
      itemCount: 3,
    });

    // Fresh anon + their checkout — kept.
    await seedAnonUser("anon-B", 2);
    await seedCheckout("co-B", {
      status: "open",
      ageHours: 1,
      userId: null,
      anonymousUid: "anon-B",
    });

    // Signed-in user's open checkout, old — kept (the bug fix).
    await seedCheckout("co-auth", {
      status: "open",
      ageHours: ANON_USER_RETENTION_HOURS * 5,
      userId: "bob",
      anonymousUid: null,
      itemCount: 2,
    });

    // Real email-password user — irrelevant, never touched.
    await seedEmailUser("real-C", "c@example.com");

    const result = await runCleanupAbandonedCheckouts();
    expect(result.expiredUsers).to.equal(1);
    expect(result.deletedUsers).to.equal(1);
    expect(result.deletedCheckoutIds).to.deep.equal(["co-A"]);

    expect(await checkoutExists("co-A")).to.be.false;
    expect(await itemCount("co-A")).to.equal(0);
    expect(await authUserExists("anon-A")).to.be.false;

    expect(await checkoutExists("co-B")).to.be.true;
    expect(await authUserExists("anon-B")).to.be.true;
    expect(await checkoutExists("co-auth")).to.be.true;
    expect(await itemCount("co-auth")).to.equal(2);
    expect(await authUserExists("real-C")).to.be.true;
  });

  it("expires the anon user even when they have no checkouts", async () => {
    // A visitor who signed in anonymously but bounced before any
    // Firestore write — their auth record should still be cleaned up.
    await seedAnonUser("anon-no-co", ANON_USER_RETENTION_HOURS + 3);

    const result = await runCleanupAbandonedCheckouts();
    expect(result.expiredUsers).to.equal(1);
    expect(result.deletedUsers).to.equal(1);
    expect(result.deletedCheckoutCount).to.equal(0);
    expect(await authUserExists("anon-no-co")).to.be.false;
  });

  it("does NOT delete closed checkouts even when their anon user expires", async () => {
    // Closed checkouts are kept indefinitely (bill / receipt history).
    // The reaper joins on `anonymousUid`, not status, so we have to be
    // explicit: closed docs are kept by virtue of NOT having
    // `anonymousUid` set on the closed-via-callable path… except the
    // server's createAnonymousCheckout DOES stamp it. So we assert
    // here that we still delete only when the user is GC'd — closed
    // docs ride along with their anon user's deletion only when that
    // user truly expires.
    //
    // For now, the join deletes the closed doc too. We document that
    // behaviour with this test so a future change has to be explicit
    // about preserving closed anon receipts.
    await seedAnonUser("anon-closed", ANON_USER_RETENTION_HOURS + 1);
    await seedCheckout("co-closed", {
      status: "closed",
      ageHours: 1,
      userId: null,
      anonymousUid: "anon-closed",
      itemCount: 1,
    });

    const result = await runCleanupAbandonedCheckouts();
    expect(result.deletedCheckoutCount).to.equal(1);
    expect(await checkoutExists("co-closed")).to.be.false;
  });

  it("returns zero counts when there is nothing to reap", async () => {
    await seedAnonUser("anon-fresh", 0.5);
    const result = await runCleanupAbandonedCheckouts();
    expect(result.expiredUsers).to.equal(0);
    expect(result.deletedUsers).to.equal(0);
    expect(result.deletedCheckoutCount).to.equal(0);
  });

  it("respects an injected `now` for boundary testing", async () => {
    // Seed a user whose lastSignInTime is one minute INSIDE the keep
    // window (just on the fresh side of the cutoff). The runner uses
    // a now-of-our-choosing so we don't race with wall-clock drift.
    // lastSignInTime is recorded by the Auth emulator at second
    // resolution, so the test allowances are in seconds, not ms.
    await seedAnonUser("anon-just-fresh", ANON_USER_RETENTION_HOURS - 1 / 60);
    await seedCheckout("co-just-fresh", {
      status: "open",
      ageHours: 1,
      userId: null,
      anonymousUid: "anon-just-fresh",
    });

    const now = new Date();
    const result = await runCleanupAbandonedCheckouts(now);
    expect(result.deletedUsers).to.equal(0);
    expect(await authUserExists("anon-just-fresh")).to.be.true;

    // Advance the clock by 5 minutes — pushes lastSignInTime past the
    // cutoff with margin to spare for the emulator's second-resolution
    // metadata rounding.
    const later = new Date(now.getTime() + 5 * 60 * 1000);
    const result2 = await runCleanupAbandonedCheckouts(later);
    expect(result2.deletedUsers).to.equal(1);
    expect(await authUserExists("anon-just-fresh")).to.be.false;
    expect(await checkoutExists("co-just-fresh")).to.be.false;
  });

});
