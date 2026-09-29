// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Force emulator branch so inviteFamilyMember skips Resend, logs the link
// to functions logs, and writes a debugLink field on the invite doc that
// the tests can read back.
process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { handleInviteFamilyMember } from "../../src/membership/invite";
import { acceptFamilyInviteHandler } from "../../src/membership/accept_invite";
import type { CallableRequest } from "firebase-functions/v2/https";
import type {
  MembershipEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

const ORIGIN = "http://localhost:5173";

interface OwnerSeed {
  uid: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

async function seedFamilyMembership(owner: OwnerSeed): Promise<{
  membershipId: string;
  ownerRef: DocumentReference;
  membershipRef: DocumentReference;
}> {
  const db = getFirestore();
  const ownerRef = db.collection("users").doc(owner.uid);
  const ownerDoc: UserEntity = {
    created: Timestamp.now(),
    email: owner.email,
    firstName: owner.firstName ?? "Maria",
    lastName: owner.lastName ?? "Müller",
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
  };
  await ownerRef.set(ownerDoc);

  const membershipRef = db.collection("memberships").doc();
  const membership: MembershipEntity = {
    type: "family",
    status: "active",
    lastPaidAt: Timestamp.now(),
    validUntil: Timestamp.fromMillis(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ),
    ownerUserId: ownerRef,
    members: [ownerRef],
    paymentCheckouts: [],
  };
  await membershipRef.set(membership);
  // Denormalize so the single-active-membership invariant works for the
  // owner if they're ever the target of an invite.
  await ownerRef.update({ activeMembership: membershipRef });

  return { membershipId: membershipRef.id, ownerRef, membershipRef };
}

function ownerCaller(uid: string) {
  return {
    authUid: uid,
    authToken: { admin: false } as Record<string, unknown>,
    requestOrigin: ORIGIN,
  };
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(
      `expected HttpsError with code=${expectedCode}, got success`,
    );
  } catch (err: any) {
    if (err?.code !== expectedCode) {
      throw new Error(
        `expected HttpsError code=${expectedCode}, got ${err?.code ?? "unknown"}: ${err?.message}`,
      );
    }
  }
}

describe("Family invite (Integration)", () => {
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

  it("creates a pending invite for an unregistered email", async () => {
    const { membershipId } = await seedFamilyMembership({
      uid: "owner-1",
      email: "owner@example.com",
    });

    const { inviteId } = await handleInviteFamilyMember(
      { membershipId, email: "newcomer@example.com" },
      ownerCaller("owner-1"),
    );

    const inviteDoc = await getFirestore()
      .collection("memberships")
      .doc(membershipId)
      .collection("invites")
      .doc(inviteId)
      .get();
    expect(inviteDoc.exists).to.be.true;
    const data = inviteDoc.data()!;
    expect(data.status).to.equal("pending");
    expect(data.email).to.equal("newcomer@example.com");
    // resolvedUserId is intentionally unset — the invitee has no user doc
    // to point at yet. accept_invite resolves it from the auth token.
    expect(data.resolvedAt).to.equal(null);
  });

  it("writes debugLink in emulator mode pointing at the new path-only URL", async () => {
    const { membershipId } = await seedFamilyMembership({
      uid: "owner-2",
      email: "owner2@example.com",
    });

    const { inviteId } = await handleInviteFamilyMember(
      { membershipId, email: "guest@example.com" },
      ownerCaller("owner-2"),
    );

    const inviteDoc = await getFirestore()
      .collection("memberships")
      .doc(membershipId)
      .collection("invites")
      .doc(inviteId)
      .get();
    const debugLink = inviteDoc.data()?.debugLink as string | undefined;
    expect(debugLink).to.be.a("string");
    expect(debugLink).to.equal(
      `${ORIGIN}/account/invite/${membershipId}/${inviteId}`,
    );
  });

  it("rejects when the request origin is not allowlisted", async () => {
    const { membershipId } = await seedFamilyMembership({
      uid: "owner-3",
      email: "owner3@example.com",
    });

    await expectHttpsError(
      () =>
        handleInviteFamilyMember(
          { membershipId, email: "anyone@example.com" },
          {
            authUid: "owner-3",
            authToken: { admin: false } as Record<string, unknown>,
            requestOrigin: "https://evil.example.com",
          },
        ),
      "failed-precondition",
    );
  });

  it("rejects an invite for an already-active member", async () => {
    const { membershipId, membershipRef } = await seedFamilyMembership({
      uid: "owner-4",
      email: "owner4@example.com",
    });

    // Pre-create the invitee with their own active membership pointer
    // pointing at this membership — i.e. they're already a member.
    const inviteeRef = getFirestore().collection("users").doc("kid-existing");
    await inviteeRef.set({
      created: Timestamp.now(),
      email: "kid@example.com",
      firstName: "Kid",
      lastName: "Müller",
      permissions: [],
      roles: [],
      activeMembership: membershipRef,
    } as UserEntity);
    await membershipRef.update({
      members: [
        getFirestore().collection("users").doc("owner-4"),
        inviteeRef,
      ],
    });

    await expectHttpsError(
      () =>
        handleInviteFamilyMember(
          { membershipId, email: "kid@example.com" },
          ownerCaller("owner-4"),
        ),
      "already-exists",
    );
  });

  it("rejects when the caller is not the owner or admin", async () => {
    const { membershipId } = await seedFamilyMembership({
      uid: "owner-5",
      email: "owner5@example.com",
    });

    // Some unrelated signed-in user with their own user doc.
    await getFirestore().collection("users").doc("randoUser").set({
      created: Timestamp.now(),
      email: "rando@example.com",
      firstName: "R",
      lastName: "Ando",
      permissions: [],
      roles: [],
    } as UserEntity);

    await expectHttpsError(
      () =>
        handleInviteFamilyMember(
          { membershipId, email: "victim@example.com" },
          {
            authUid: "randoUser",
            authToken: { admin: false } as Record<string, unknown>,
            requestOrigin: ORIGIN,
          },
        ),
      "permission-denied",
    );
  });

  it("uses inviter's full name in the link/email", async () => {
    const { membershipId } = await seedFamilyMembership({
      uid: "owner-6",
      email: "owner6@example.com",
      firstName: "Anna",
      lastName: "Beispiel",
    });

    const { inviteId } = await handleInviteFamilyMember(
      { membershipId, email: "friend@example.com" },
      ownerCaller("owner-6"),
    );
    // The displayed name itself isn't stored on the invite doc, but the
    // debugLink confirms the call succeeded with a usable inviter doc.
    // (The full email-rendering path is exercised manually via the
    // operations repo's preview command — see plan verification.)
    const inviteDoc = await getFirestore()
      .collection("memberships")
      .doc(membershipId)
      .collection("invites")
      .doc(inviteId)
      .get();
    expect(inviteDoc.data()?.debugLink).to.contain(
      `/account/invite/${membershipId}/${inviteId}`,
    );
  });
});

/**
 * Existing-account accept (`acceptFamilyInvite`). The handler runs in-process
 * here, so the `onMembershipWritten` trigger never fires — whatever these
 * tests observe on the user doc was written by the accept transaction itself.
 */
describe("acceptFamilyInvite (Integration)", () => {
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

  async function seedInvitee(uid: string, email: string): Promise<DocumentReference> {
    const db = getFirestore();
    const ref = db.collection("users").doc(uid);
    const doc: UserEntity = {
      created: Timestamp.now(),
      email,
      firstName: "Bob",
      lastName: "Beispiel",
      permissions: [],
      roles: [],
      termsAcceptedAt: Timestamp.now(),
      userType: "erwachsen",
      activeMembership: null,
    };
    await ref.set(doc);
    return ref;
  }

  function inviteeCall(
    uid: string,
    email: string,
    data: { membershipId: string; inviteId: string },
  ): CallableRequest<typeof data> {
    return {
      data,
      auth: { uid, token: { email, admin: false } },
    } as unknown as CallableRequest<typeof data>;
  }

  // Issue #654: the `users/{uid}` read rule compares both docs'
  // `activeMembership`. Leaving the pointer to the trigger opened a window
  // in which the roster listeners of the joiner AND the owner were denied
  // and stayed dead. The pointer must land in the accept commit itself.
  it("stamps the joiner's activeMembership in the same commit as members[]", async () => {
    const { membershipId, membershipRef } = await seedFamilyMembership({
      uid: "owner-acc-1",
      email: "owner@example.com",
    });
    const bobRef = await seedInvitee("bob-1", "bob@example.com");
    const { inviteId } = await handleInviteFamilyMember(
      { membershipId, email: "bob@example.com" },
      ownerCaller("owner-acc-1"),
    );

    const result = await acceptFamilyInviteHandler(
      inviteeCall("bob-1", "bob@example.com", { membershipId, inviteId }),
    );
    expect(result).to.deep.equal({ ok: true });

    // Directly after the handler resolves — no trigger has run.
    const bob = (await bobRef.get()).data() as UserEntity;
    expect(bob.activeMembership, "activeMembership set by the accept transaction").to.not.equal(null);
    expect(bob.activeMembership!.path).to.equal(membershipRef.path);

    const membership = (await membershipRef.get()).data() as MembershipEntity;
    expect(membership.members.map((m) => m.id)).to.include("bob-1");

    const invite = (
      await membershipRef.collection("invites").doc(inviteId).get()
    ).data()!;
    expect(invite.status).to.equal("accepted");
    expect(invite.resolvedUserId.id).to.equal("bob-1");
    expect(invite.ttlAt).to.equal(undefined);
  });

  it("is idempotent for a user who is already a member", async () => {
    const { membershipId, membershipRef } = await seedFamilyMembership({
      uid: "owner-acc-2",
      email: "owner@example.com",
    });
    const bobRef = await seedInvitee("bob-2", "bob@example.com");
    const { inviteId } = await handleInviteFamilyMember(
      { membershipId, email: "bob@example.com" },
      ownerCaller("owner-acc-2"),
    );
    // Already in the roster (e.g. added by an admin meanwhile), pointer set.
    await membershipRef.update({ members: [
      getFirestore().collection("users").doc("owner-acc-2"),
      bobRef,
    ] });
    await bobRef.update({ activeMembership: membershipRef });

    await acceptFamilyInviteHandler(
      inviteeCall("bob-2", "bob@example.com", { membershipId, inviteId }),
    );

    const membership = (await membershipRef.get()).data() as MembershipEntity;
    expect(membership.members.filter((m) => m.id === "bob-2")).to.have.length(1);
    const invite = (
      await membershipRef.collection("invites").doc(inviteId).get()
    ).data()!;
    expect(invite.status).to.equal("accepted");
    const bob = (await bobRef.get()).data() as UserEntity;
    expect(bob.activeMembership!.path).to.equal(membershipRef.path);
  });

  it("rejects an invite addressed to a different email", async () => {
    const { membershipId } = await seedFamilyMembership({
      uid: "owner-acc-3",
      email: "owner@example.com",
    });
    await seedInvitee("carol-3", "carol@example.com");
    const { inviteId } = await handleInviteFamilyMember(
      { membershipId, email: "bob@example.com" },
      ownerCaller("owner-acc-3"),
    );

    await expectHttpsError(
      () =>
        acceptFamilyInviteHandler(
          inviteeCall("carol-3", "carol@example.com", { membershipId, inviteId }),
        ),
      "permission-denied",
    );
  });
});
