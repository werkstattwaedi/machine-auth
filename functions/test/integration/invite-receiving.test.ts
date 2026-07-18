// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Receiving end of the family invite: the public info callable and the
// no-code account-creation accept callable.

process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { handleGetFamilyInviteInfo } from "../../src/membership/invite_info";
import { handleAcceptInviteNewAccount } from "../../src/membership/accept_invite_new_account";
import { listMyFamilyInvitesHandler } from "../../src/membership/list_my_invites";
import type {
  MembershipEntity,
  MembershipInviteEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

const ORIGIN = "http://localhost:5173";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface InviteSeedOpts {
  status?: MembershipInviteEntity["status"];
  ttlMs?: number; // offset from now; negative = expired
}

async function seed(
  email: string,
  opts: InviteSeedOpts = {},
): Promise<{ membershipId: string; inviteId: string }> {
  const db = getFirestore();
  const ownerRef = db.collection("users").doc("owner-rcv");
  await ownerRef.set({
    created: Timestamp.now(),
    email: "owner@example.com",
    firstName: "Anna",
    lastName: "Müller",
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
  } as UserEntity);

  const memRef = db.collection("memberships").doc();
  await memRef.set({
    type: "family",
    status: "active",
    lastPaidAt: Timestamp.now(),
    validUntil: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ownerUserId: ownerRef,
    members: [ownerRef],
    paymentCheckouts: [],
  } as MembershipEntity);
  await ownerRef.update({ activeMembership: memRef });

  const inviteRef = memRef.collection("invites").doc();
  await inviteRef.set({
    email: email.toLowerCase(),
    status: opts.status ?? "pending",
    invitedAt: Timestamp.now(),
    invitedBy: ownerRef as DocumentReference,
    resolvedAt: null,
    ttlAt: Timestamp.fromMillis(Date.now() + (opts.ttlMs ?? TTL_MS)),
  } as MembershipInviteEntity);

  return { membershipId: memRef.id, inviteId: inviteRef.id };
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

describe("Family invite receiving (Integration)", () => {
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

  describe("getFamilyInviteInfo", () => {
    it("returns pending + accountExists=false for a fresh email", async () => {
      const { membershipId, inviteId } = await seed("newcomer@example.com");
      const info = await handleGetFamilyInviteInfo(
        { membershipId, inviteId },
        ORIGIN,
      );
      expect(info.status).to.equal("pending");
      expect(info.email).to.equal("newcomer@example.com");
      expect(info.accountExists).to.equal(false);
      expect(info.inviterName).to.equal("Anna Müller");
      expect(info.inviterEmail).to.equal("owner@example.com");
    });

    it("reports accountExists=true when a completed account exists", async () => {
      const { membershipId, inviteId } = await seed("hasacct@example.com");
      await getFirestore().collection("users").doc("existing-acct").set({
        created: Timestamp.now(),
        email: "hasacct@example.com",
        firstName: "Has",
        lastName: "Account",
        permissions: [],
        roles: [],
        termsAcceptedAt: Timestamp.now(),
      } as UserEntity);
      const info = await handleGetFamilyInviteInfo(
        { membershipId, inviteId },
        ORIGIN,
      );
      expect(info.accountExists).to.equal(true);
    });

    it("returns expired for a pending invite past its TTL", async () => {
      const { membershipId, inviteId } = await seed("late@example.com", {
        ttlMs: -1000,
      });
      const info = await handleGetFamilyInviteInfo(
        { membershipId, inviteId },
        ORIGIN,
      );
      expect(info.status).to.equal("expired");
    });

    it("reflects a non-pending invite status", async () => {
      const { membershipId, inviteId } = await seed("done@example.com", {
        status: "accepted",
      });
      const info = await handleGetFamilyInviteInfo(
        { membershipId, inviteId },
        ORIGIN,
      );
      expect(info.status).to.equal("accepted");
    });

    it("returns not_found for a missing invite", async () => {
      const { membershipId } = await seed("x@example.com");
      const info = await handleGetFamilyInviteInfo(
        { membershipId, inviteId: "does-not-exist" },
        ORIGIN,
      );
      expect(info.status).to.equal("not_found");
    });

    it("rejects a disallowed origin", async () => {
      const { membershipId, inviteId } = await seed("y@example.com");
      await expectHttpsError(
        () =>
          handleGetFamilyInviteInfo(
            { membershipId, inviteId },
            "https://evil.example.com",
          ),
        "failed-precondition",
      );
    });
  });

  describe("acceptFamilyInviteNewAccount", () => {
    it("creates the account, accepts the invite, returns a custom token", async () => {
      const { membershipId, inviteId } = await seed("join@example.com");
      const { customToken } = await handleAcceptInviteNewAccount(
        {
          membershipId,
          inviteId,
          firstName: "Neu",
          lastName: "Mitglied",
          userType: "erwachsen",
          termsAccepted: true,
        },
        ORIGIN,
      );
      expect(customToken).to.be.a("string").with.length.greaterThan(0);

      // User doc exists for the invited email with accepted terms.
      const userSnap = await getFirestore()
        .collection("users")
        .where("email", "==", "join@example.com")
        .limit(1)
        .get();
      expect(userSnap.empty).to.equal(false);
      const userData = userSnap.docs[0].data();
      expect(userData.firstName).to.equal("Neu");
      expect(userData.userType).to.equal("erwachsen");
      expect(userData.termsAcceptedAt).to.not.equal(null);

      // Added to members[] and invite flipped to accepted.
      const memSnap = await getFirestore()
        .collection("memberships")
        .doc(membershipId)
        .get();
      const memberIds = (memSnap.data()!.members as DocumentReference[]).map(
        (r) => r.id,
      );
      expect(memberIds).to.include(userSnap.docs[0].id);

      const inviteSnap = await getFirestore()
        .collection("memberships")
        .doc(membershipId)
        .collection("invites")
        .doc(inviteId)
        .get();
      expect(inviteSnap.data()!.status).to.equal("accepted");
    });

    it("rejects when terms are not accepted", async () => {
      const { membershipId, inviteId } = await seed("noterms@example.com");
      await expectHttpsError(
        () =>
          handleAcceptInviteNewAccount(
            {
              membershipId,
              inviteId,
              firstName: "No",
              lastName: "Terms",
              userType: "erwachsen",
              termsAccepted: false,
            },
            ORIGIN,
          ),
        "failed-precondition",
      );
    });

    it("rejects missing names", async () => {
      const { membershipId, inviteId } = await seed("noname@example.com");
      await expectHttpsError(
        () =>
          handleAcceptInviteNewAccount(
            {
              membershipId,
              inviteId,
              firstName: "",
              lastName: "",
              userType: "erwachsen",
              termsAccepted: true,
            },
            ORIGIN,
          ),
        "invalid-argument",
      );
    });

    it("diverts a completed account to login (already-exists)", async () => {
      const { membershipId, inviteId } = await seed("existing@example.com");
      await getFirestore().collection("users").doc("existing-rcv").set({
        created: Timestamp.now(),
        email: "existing@example.com",
        firstName: "Has",
        lastName: "Account",
        permissions: [],
        roles: [],
        termsAcceptedAt: Timestamp.now(),
      } as UserEntity);
      await expectHttpsError(
        () =>
          handleAcceptInviteNewAccount(
            {
              membershipId,
              inviteId,
              firstName: "Has",
              lastName: "Account",
              userType: "erwachsen",
              termsAccepted: true,
            },
            ORIGIN,
          ),
        "already-exists",
      );
    });

    it("persists userType kind", async () => {
      const { membershipId, inviteId } = await seed("kid@example.com");
      await handleAcceptInviteNewAccount(
        {
          membershipId,
          inviteId,
          firstName: "Klein",
          lastName: "Kind",
          userType: "kind",
          termsAccepted: true,
        },
        ORIGIN,
      );
      const userSnap = await getFirestore()
        .collection("users")
        .where("email", "==", "kid@example.com")
        .limit(1)
        .get();
      expect(userSnap.docs[0].get("userType")).to.equal("kind");
    });

    it("persists a firma with billing address", async () => {
      const { membershipId, inviteId } = await seed("firma@example.com");
      await handleAcceptInviteNewAccount(
        {
          membershipId,
          inviteId,
          firstName: "Firmen",
          lastName: "Chef",
          userType: "firma",
          termsAccepted: true,
          billingAddress: {
            company: "ACME AG",
            street: "Bahnhofstr. 1",
            zip: "8820",
            city: "Wädenswil",
          },
        },
        ORIGIN,
      );
      const userSnap = await getFirestore()
        .collection("users")
        .where("email", "==", "firma@example.com")
        .limit(1)
        .get();
      const data = userSnap.docs[0].data();
      expect(data.userType).to.equal("firma");
      expect(data.billingAddress?.company).to.equal("ACME AG");
    });

    it("rejects a firma without a complete address", async () => {
      const { membershipId, inviteId } = await seed("firma2@example.com");
      await expectHttpsError(
        () =>
          handleAcceptInviteNewAccount(
            {
              membershipId,
              inviteId,
              firstName: "Firmen",
              lastName: "Chef",
              userType: "firma",
              termsAccepted: true,
            },
            ORIGIN,
          ),
        "invalid-argument",
      );
    });

    it("rejects a non-pending invite", async () => {
      const { membershipId, inviteId } = await seed("revoked@example.com", {
        status: "revoked",
      });
      await expectHttpsError(
        () =>
          handleAcceptInviteNewAccount(
            {
              membershipId,
              inviteId,
              firstName: "A",
              lastName: "B",
              userType: "erwachsen",
              termsAccepted: true,
            },
            ORIGIN,
          ),
        "failed-precondition",
      );
    });

    it("rejects a disallowed origin", async () => {
      const { membershipId, inviteId } = await seed("origin@example.com");
      await expectHttpsError(
        () =>
          handleAcceptInviteNewAccount(
            {
              membershipId,
              inviteId,
              firstName: "A",
              lastName: "B",
              userType: "erwachsen",
              termsAccepted: true,
            },
            "https://evil.example.com",
          ),
        "failed-precondition",
      );
    });
  });

  describe("listMyFamilyInvites", () => {
    function authedRequest(email: string | null): CallableRequest<unknown> {
      return {
        data: {},
        auth: { uid: "invitee-uid", token: email ? { email } : {} },
      } as unknown as CallableRequest<unknown>;
    }

    it("lists a pending invite addressed to the token email", async () => {
      const { membershipId, inviteId } = await seed("listed@example.com");
      const result = await listMyFamilyInvitesHandler(
        authedRequest("listed@example.com"),
      );
      expect(result.invites).to.have.length(1);
      expect(result.invites[0]).to.deep.equal({
        membershipId,
        inviteId,
        inviterName: "Anna Müller",
      });
    });

    it("matches the token email case-insensitively", async () => {
      await seed("mixedcase@example.com");
      const result = await listMyFamilyInvitesHandler(
        authedRequest("MixedCase@Example.com"),
      );
      expect(result.invites).to.have.length(1);
    });

    it("excludes invites addressed to other emails", async () => {
      await seed("someone-else@example.com");
      const result = await listMyFamilyInvitesHandler(
        authedRequest("me@example.com"),
      );
      expect(result.invites).to.have.length(0);
    });

    it("excludes non-pending invites", async () => {
      await seed("resolved@example.com", { status: "accepted" });
      const result = await listMyFamilyInvitesHandler(
        authedRequest("resolved@example.com"),
      );
      expect(result.invites).to.have.length(0);
    });

    it("excludes TTL-expired invites", async () => {
      await seed("expired@example.com", { ttlMs: -1000 });
      const result = await listMyFamilyInvitesHandler(
        authedRequest("expired@example.com"),
      );
      expect(result.invites).to.have.length(0);
    });

    it("returns an empty list when the token carries no email", async () => {
      await seed("no-email-token@example.com");
      const result = await listMyFamilyInvitesHandler(authedRequest(null));
      expect(result.invites).to.have.length(0);
    });

    it("rejects unauthenticated calls", async () => {
      await expectHttpsError(
        () =>
          listMyFamilyInvitesHandler({
            data: {},
          } as unknown as CallableRequest<unknown>),
        "unauthenticated",
      );
    });
  });
});
