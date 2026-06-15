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
import { createManagedMemberHandler } from "../../src/membership/create_managed_member";
import type {
  MembershipEntity,
  UserEntity,
} from "../../src/types/firestore_entities";

interface SeedOpts {
  type?: "single" | "family";
  status?: "active" | "expired" | "cancelled";
}

async function seedMembership(
  ownerUid: string,
  opts: SeedOpts = {},
): Promise<{ membershipId: string; ownerRef: DocumentReference }> {
  const db = getFirestore();
  const ownerRef = db.collection("users").doc(ownerUid);
  const ownerDoc: UserEntity = {
    created: Timestamp.now(),
    email: "owner@example.com",
    firstName: "Anna",
    lastName: "Müller",
    permissions: [],
    roles: [],
    termsAcceptedAt: Timestamp.now(),
    userType: "erwachsen",
    activeMembership: null,
  };
  await ownerRef.set(ownerDoc);

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
  isAdmin = false,
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
    throw new Error(`expected HttpsError code=${expectedCode}, got success`);
  } catch (err: any) {
    if (err?.code !== expectedCode) {
      throw new Error(
        `expected HttpsError code=${expectedCode}, got ${err?.code ?? "unknown"}: ${err?.message}`,
      );
    }
  }
}

describe("createManagedMember (Integration)", () => {
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

  it("owner creates a login-less adult and adds it to members[]", async () => {
    const { membershipId } = await seedMembership("owner-adult");

    const { uid } = await createManagedMemberHandler(
      callable("owner-adult", {
        membershipId,
        firstName: "Opa",
        lastName: "Müller",
        userType: "erwachsen",
      }),
    );

    const userDoc = await getFirestore().collection("users").doc(uid).get();
    expect(userDoc.exists).to.be.true;
    const data = userDoc.data()!;
    expect(data.email).to.equal(null);
    expect(data.userType).to.equal("erwachsen");
    expect(data.termsAcceptedAt).to.equal(null);

    const memberDoc = await getFirestore()
      .collection("memberships")
      .doc(membershipId)
      .get();
    const memberIds = (memberDoc.data()!.members as DocumentReference[]).map(
      (r) => r.id,
    );
    expect(memberIds).to.include(uid);
  });

  it("owner creates a login-less child with userType kind", async () => {
    const { membershipId } = await seedMembership("owner-kid");

    const { uid } = await createManagedMemberHandler(
      callable("owner-kid", {
        membershipId,
        firstName: "Mia",
        lastName: "Müller",
        userType: "kind",
      }),
    );

    const data = (await getFirestore().collection("users").doc(uid).get()).data()!;
    expect(data.userType).to.equal("kind");
    expect(data.email).to.equal(null);
  });

  it("rejects userType firma", async () => {
    const { membershipId } = await seedMembership("owner-firma");
    await expectHttpsError(
      () =>
        createManagedMemberHandler(
          callable("owner-firma", {
            membershipId,
            firstName: "A",
            lastName: "G",
            userType: "firma",
          }),
        ),
      "invalid-argument",
    );
  });

  it("rejects a missing userType", async () => {
    const { membershipId } = await seedMembership("owner-missing");
    await expectHttpsError(
      () =>
        createManagedMemberHandler(
          callable("owner-missing", {
            membershipId,
            firstName: "A",
            lastName: "G",
          }),
        ),
      "invalid-argument",
    );
  });

  it("rejects when the caller is not the owner", async () => {
    const { membershipId } = await seedMembership("owner-perm");
    await getFirestore().collection("users").doc("rando").set({
      created: Timestamp.now(),
      email: "rando@example.com",
      firstName: "R",
      lastName: "Ando",
      permissions: [],
      roles: [],
    } as UserEntity);

    await expectHttpsError(
      () =>
        createManagedMemberHandler(
          callable("rando", {
            membershipId,
            firstName: "Mia",
            lastName: "Müller",
            userType: "kind",
          }),
        ),
      "permission-denied",
    );
  });

  it("rejects a non-family membership", async () => {
    const { membershipId } = await seedMembership("owner-single", {
      type: "single",
    });
    await expectHttpsError(
      () =>
        createManagedMemberHandler(
          callable("owner-single", {
            membershipId,
            firstName: "Mia",
            lastName: "Müller",
            userType: "kind",
          }),
        ),
      "failed-precondition",
    );
  });

  it("rejects an inactive membership", async () => {
    const { membershipId } = await seedMembership("owner-expired", {
      status: "expired",
    });
    await expectHttpsError(
      () =>
        createManagedMemberHandler(
          callable("owner-expired", {
            membershipId,
            firstName: "Mia",
            lastName: "Müller",
            userType: "kind",
          }),
        ),
      "failed-precondition",
    );
  });
});
