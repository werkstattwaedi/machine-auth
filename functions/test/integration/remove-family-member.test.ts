// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { removeFamilyMemberHandler } from "../../src/membership/remove";
import type {
  MembershipEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

async function seedFamily(
  ownerUid: string,
  memberUids: string[],
): Promise<string> {
  const db = getFirestore();
  const ownerRef = db.collection("users").doc(ownerUid);
  const userDoc = (first: string): UserEntity => ({
    created: Timestamp.now(),
    email: `${first}@example.com`,
    firstName: first,
    lastName: "Test",
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
  });
  await ownerRef.set(userDoc(ownerUid));
  const members = [ownerRef];
  for (const uid of memberUids) {
    const ref = db.collection("users").doc(uid);
    await ref.set(userDoc(uid));
    members.push(ref);
  }
  const memRef = db.collection("memberships").doc();
  await memRef.set({
    type: "family",
    status: "active",
    lastPaidAt: Timestamp.now(),
    validUntil: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ownerUserId: ownerRef,
    members,
    paymentCheckouts: [],
  } as MembershipEntity);
  return memRef.id;
}

function callable(
  uid: string,
  data: Record<string, unknown>,
  isAdmin = false,
): CallableRequest<any> {
  return {
    data,
    auth: { uid, token: { admin: isAdmin } },
  } as unknown as CallableRequest<any>;
}

async function members(membershipId: string): Promise<string[]> {
  const snap = await getFirestore()
    .collection("memberships")
    .doc(membershipId)
    .get();
  return (snap.data()!.members as DocumentReference[]).map((r) => r.id);
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(`expected HttpsError code=${expectedCode}, got success`);
  } catch (err: any) {
    if (err?.code !== expectedCode) {
      throw new Error(
        `expected HttpsError code=${expectedCode}, got ${err?.code ?? "unknown"}: ${err?.message}`,
      );
    }
  }
}

describe("removeFamilyMember (Integration)", () => {
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

  it("lets a member remove themselves", async () => {
    const membershipId = await seedFamily("owner-a", ["member-a"]);
    await removeFamilyMemberHandler(
      callable("member-a", { membershipId, userId: "member-a" }),
    );
    expect(await members(membershipId)).to.not.include("member-a");
    expect(await members(membershipId)).to.include("owner-a");
  });

  it("lets the owner remove another member", async () => {
    const membershipId = await seedFamily("owner-b", ["member-b"]);
    await removeFamilyMemberHandler(
      callable("owner-b", { membershipId, userId: "member-b" }),
    );
    expect(await members(membershipId)).to.not.include("member-b");
  });

  it("forbids a member removing a different member", async () => {
    const membershipId = await seedFamily("owner-c", ["member-c1", "member-c2"]);
    await expectHttpsError(
      () =>
        removeFamilyMemberHandler(
          callable("member-c1", { membershipId, userId: "member-c2" }),
        ),
      "permission-denied",
    );
    expect(await members(membershipId)).to.include("member-c2");
  });

  it("refuses to remove the owner (use cancel instead)", async () => {
    const membershipId = await seedFamily("owner-d", ["member-d"]);
    await expectHttpsError(
      () =>
        removeFamilyMemberHandler(
          callable("owner-d", { membershipId, userId: "owner-d" }),
        ),
      "failed-precondition",
    );
  });
});
