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
import { adminAddFamilyMemberHandler } from "../../src/membership/admin";
import type {
  MembershipEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

interface SeedOpts {
  type?: "single" | "family";
  status?: "active" | "expired" | "cancelled";
}

async function seedUser(
  uid: string,
  activeMembership: DocumentReference | null = null,
): Promise<DocumentReference> {
  const ref = getFirestore().collection("users").doc(uid);
  const doc: UserEntity = {
    created: Timestamp.now(),
    email: `${uid}@example.com`,
    firstName: "Test",
    lastName: uid,
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership,
  };
  await ref.set(doc);
  return ref;
}

async function seedMembership(
  ownerUid: string,
  opts: SeedOpts = {},
): Promise<{ membershipId: string; ownerRef: DocumentReference }> {
  const db = getFirestore();
  const ownerRef = await seedUser(ownerUid);

  const membershipRef = db.collection("memberships").doc();
  const membership: MembershipEntity = {
    type: opts.type ?? "family",
    status: opts.status ?? "active",
    lastPaidAt: Timestamp.now(),
    validUntil: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ownerUserId: ownerRef,
    members: [ownerRef],
    paymentCheckouts: [],
  };
  await membershipRef.set(membership);
  await ownerRef.update({ activeMembership: membershipRef });

  return { membershipId: membershipRef.id, ownerRef };
}

function callable(
  uid: string,
  data: Record<string, unknown>,
  isAdmin = true,
): CallableRequest<any> {
  return {
    data,
    auth: { uid, token: { admin: isAdmin } },
  } as unknown as CallableRequest<any>;
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    if (err?.code !== expectedCode) {
      throw new Error(
        `expected HttpsError code=${expectedCode}, got ${err?.code ?? "unknown"}: ${err?.message}`,
      );
    }
    return;
  }
  throw new Error(`expected HttpsError code=${expectedCode}, got success`);
}

async function memberIds(membershipId: string): Promise<string[]> {
  const snap = await getFirestore()
    .collection("memberships")
    .doc(membershipId)
    .get();
  return (snap.data()!.members as DocumentReference[]).map((r) => r.id);
}

describe("adminAddFamilyMember (Integration)", () => {
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

  it("admin adds an existing user to members[] without creating an invite", async () => {
    const { membershipId } = await seedMembership("owner-happy");
    await seedUser("target-happy");

    const res = await adminAddFamilyMemberHandler(
      callable("admin-uid", { membershipId, userId: "target-happy" }),
    );
    expect(res).to.deep.equal({ ok: true });

    expect(await memberIds(membershipId)).to.have.members([
      "owner-happy",
      "target-happy",
    ]);

    const memSnap = await getFirestore()
      .collection("memberships")
      .doc(membershipId)
      .get();
    expect(memSnap.data()!.modifiedBy).to.equal("admin-uid");

    // Issue #622: the admin path must never go through the invite flow.
    const invites = await getFirestore()
      .collection("memberships")
      .doc(membershipId)
      .collection("invites")
      .get();
    expect(invites.empty).to.be.true;
  });

  it("adds a login-less user (email null)", async () => {
    const { membershipId } = await seedMembership("owner-managed");
    const targetRef = await seedUser("target-managed");
    await targetRef.update({ email: null });

    await adminAddFamilyMemberHandler(
      callable("admin-uid", { membershipId, userId: "target-managed" }),
    );
    expect(await memberIds(membershipId)).to.include("target-managed");
  });

  it("rejects a non-admin caller, including the membership owner", async () => {
    const { membershipId } = await seedMembership("owner-perm");
    await seedUser("target-perm");

    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable(
            "owner-perm",
            { membershipId, userId: "target-perm" },
            false,
          ),
        ),
      "permission-denied",
    );
    expect(await memberIds(membershipId)).to.deep.equal(["owner-perm"]);
  });

  it("rejects missing arguments", async () => {
    const { membershipId } = await seedMembership("owner-args");
    await expectHttpsError(
      () => adminAddFamilyMemberHandler(callable("admin-uid", { membershipId })),
      "invalid-argument",
    );
    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable("admin-uid", { userId: "someone" }),
        ),
      "invalid-argument",
    );
  });

  it("rejects a user who is already a member", async () => {
    const { membershipId } = await seedMembership("owner-dup");
    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable("admin-uid", { membershipId, userId: "owner-dup" }),
        ),
      "already-exists",
    );
  });

  it("rejects a user with a different active membership", async () => {
    const { membershipId } = await seedMembership("owner-a");
    const other = await seedMembership("owner-b");

    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable("admin-uid", { membershipId, userId: "owner-b" }),
        ),
      "failed-precondition",
    );
    expect(await memberIds(membershipId)).to.deep.equal(["owner-a"]);
    expect(await memberIds(other.membershipId)).to.deep.equal(["owner-b"]);
  });

  it("rejects a single membership", async () => {
    const { membershipId } = await seedMembership("owner-single", {
      type: "single",
    });
    await seedUser("target-single");
    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable("admin-uid", { membershipId, userId: "target-single" }),
        ),
      "failed-precondition",
    );
  });

  it("rejects an inactive membership", async () => {
    const { membershipId } = await seedMembership("owner-expired", {
      status: "expired",
    });
    await seedUser("target-expired");
    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable("admin-uid", { membershipId, userId: "target-expired" }),
        ),
      "failed-precondition",
    );
  });

  it("rejects an unknown user", async () => {
    const { membershipId } = await seedMembership("owner-ghost");
    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable("admin-uid", { membershipId, userId: "does-not-exist" }),
        ),
      "not-found",
    );
  });

  it("rejects an unknown membership", async () => {
    await seedUser("target-nomem");
    await expectHttpsError(
      () =>
        adminAddFamilyMemberHandler(
          callable("admin-uid", {
            membershipId: "does-not-exist",
            userId: "target-nomem",
          }),
        ),
      "not-found",
    );
  });
});
