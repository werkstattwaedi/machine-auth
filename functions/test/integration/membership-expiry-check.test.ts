// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Coverage for `runMembershipExpiryCheck` in
 * `functions/src/membership/expiry_check.ts` (part of the daily
 * `dailyMembershipMaintenance` job).
 *
 * Pattern mirrors `issue-membership-renewal-bills.test.ts`: invoke the
 * exported helper directly against the Firestore emulator. The
 * `onMembershipWritten` trigger (which clears `activeMembership` on the
 * user doc) is not started in this harness, so assertions stay on the
 * membership docs themselves.
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
import { runMembershipExpiryCheck } from "../../src/membership/expiry_check";
import type {
  MembershipEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedUser(uid: string): Promise<DocumentReference> {
  const db = getFirestore();
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
  const ref = db.collection("users").doc(uid);
  await ref.set(user);
  return ref;
}

async function seedMembership(
  id: string,
  ownerUid: string,
  validUntil: Date,
  status: MembershipEntity["status"] = "active",
): Promise<void> {
  const db = getFirestore();
  const ownerRef = await seedUser(ownerUid);
  const doc: MembershipEntity = {
    type: "single",
    status,
    lastPaidAt: Timestamp.fromMillis(validUntil.getTime() - 365 * DAY_MS),
    validUntil: Timestamp.fromDate(validUntil),
    ownerUserId: ownerRef,
    members: [ownerRef],
    paymentCheckouts: [],
    notes: null,
    created: Timestamp.now(),
    modifiedAt: Timestamp.now(),
    modifiedBy: null,
  };
  await db.collection("memberships").doc(id).set(doc);
}

async function readMembership(id: string): Promise<MembershipEntity> {
  const snap = await getFirestore().collection("memberships").doc(id).get();
  return snap.data() as MembershipEntity;
}

describe("runMembershipExpiryCheck (Integration)", () => {
  const now = new Date();
  const past = new Date(now.getTime() - 2 * DAY_MS);
  const future = new Date(now.getTime() + 100 * DAY_MS);

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

  it("flips only active memberships past validUntil to expired", async () => {
    await seedMembership("m-past", "alice", past);
    await seedMembership("m-future", "bob", future);

    const flipped = await runMembershipExpiryCheck();
    expect(flipped).to.equal(1);

    expect((await readMembership("m-past")).status).to.equal("expired");
    expect((await readMembership("m-future")).status).to.equal("active");
  });

  it("leaves cancelled memberships untouched even when past validUntil", async () => {
    await seedMembership("m-cancelled", "carol", past, "cancelled");

    const flipped = await runMembershipExpiryCheck();
    expect(flipped).to.equal(0);
    expect((await readMembership("m-cancelled")).status).to.equal("cancelled");
  });

  it("is idempotent — a second run is a no-op", async () => {
    await seedMembership("m-idem", "dave", past);

    expect(await runMembershipExpiryCheck()).to.equal(1);
    expect(await runMembershipExpiryCheck()).to.equal(0);
    expect((await readMembership("m-idem")).status).to.equal("expired");
  });
});
