// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Login resolution + Auth self-heal (ADR-0043, issue #633): the users doc is
// canonical, Auth follows. Also the regression net for the bare-record
// deletion guard (docs/disaster-recovery.md "Deletion paths") — one case per
// guard term, each asserting the record survives.

import { expect } from "chai";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  defaultIdentityDeps,
  isBareAuthRecord,
  resolveLoginUid,
} from "../../src/auth/identity";

const MEMBER_UID = "member-1";
const EMAIL = "member@example.com";

async function seedUserDoc(
  uid: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await getFirestore()
    .collection("users")
    .doc(uid)
    .set({
      created: Timestamp.now(),
      email: EMAIL,
      firstName: "Mia",
      lastName: "Member",
      roles: [],
      permissions: [],
      userType: "erwachsen",
      termsAcceptedAt: Timestamp.now(),
      ...overrides,
    });
}

async function getUserOrNull(uid: string): Promise<UserRecord | null> {
  try {
    return await getAuth().getUser(uid);
  } catch {
    return null;
  }
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    expect(err?.code, err?.message).to.equal(expectedCode);
    return;
  }
  throw new Error(`expected HttpsError ${expectedCode}, got success`);
}

describe("resolveLoginUid (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    const auth = getAuth();
    const users = await auth.listUsers();
    await Promise.all(users.users.map((u) => auth.deleteUser(u.uid)));
  });

  const resolve = (email: string) =>
    resolveLoginUid(defaultIdentityDeps(), email);

  describe("users doc first", () => {
    it("signs in on the doc's uid and recreates a missing Auth record", async () => {
      await seedUserDoc(MEMBER_UID);

      const uid = await resolve(EMAIL);

      expect(uid).to.equal(MEMBER_UID);
      const user = await getAuth().getUser(MEMBER_UID);
      expect(user.email).to.equal(EMAIL);
      expect(user.displayName).to.equal("Mia Member");
      expect(user.customClaims).to.deep.equal({ admin: false });
    });

    it("gives a recreated admin the admin claim back", async () => {
      await seedUserDoc(MEMBER_UID, { roles: ["admin"] });

      await resolve(EMAIL);

      const user = await getAuth().getUser(MEMBER_UID);
      expect(user.customClaims).to.deep.equal({ admin: true });
    });

    it("moves a drifted Auth e-mail onto the doc's e-mail, same uid", async () => {
      await seedUserDoc(MEMBER_UID);
      await getAuth().createUser({ uid: MEMBER_UID, email: "old@example.com" });

      const uid = await resolve(EMAIL);

      expect(uid).to.equal(MEMBER_UID);
      expect((await getAuth().getUser(MEMBER_UID)).email).to.equal(EMAIL);
    });

    it("leaves a matching Auth record untouched", async () => {
      await seedUserDoc(MEMBER_UID);
      await getAuth().createUser({ uid: MEMBER_UID, email: EMAIL });
      await getAuth().setCustomUserClaims(MEMBER_UID, { admin: false });
      const before = await getAuth().getUser(MEMBER_UID);

      expect(await resolve(EMAIL)).to.equal(MEMBER_UID);

      const after = await getAuth().getUser(MEMBER_UID);
      expect(after.toJSON()).to.deep.equal(before.toJSON());
    });

    it("promotes a managed member: e-mail set and record enabled", async () => {
      await seedUserDoc(MEMBER_UID);
      // createManagedMember's shape: disabled, no e-mail.
      await getAuth().createUser({ uid: MEMBER_UID, disabled: true });

      await resolve(EMAIL);

      const user = await getAuth().getUser(MEMBER_UID);
      expect(user.email).to.equal(EMAIL);
      expect(user.disabled).to.equal(false);
    });

    it("corrects the e-mail of a manually disabled record but keeps the block", async () => {
      await seedUserDoc(MEMBER_UID);
      await getAuth().createUser({
        uid: MEMBER_UID,
        email: "old@example.com",
        disabled: true,
      });

      await resolve(EMAIL);

      const user = await getAuth().getUser(MEMBER_UID);
      expect(user.email).to.equal(EMAIL);
      expect(user.disabled).to.equal(true);
    });

    it("refuses when two users docs share the e-mail", async () => {
      await seedUserDoc(MEMBER_UID);
      await seedUserDoc("member-2");

      await expectHttpsError(() => resolve(EMAIL), "failed-precondition");
    });
  });

  describe("bare-record reclaim (deletion guard)", () => {
    it("deletes a bare record squatting on the member's e-mail", async () => {
      await seedUserDoc(MEMBER_UID);
      // What an abandoned code request leaves behind.
      const bare = await getAuth().createUser({ email: EMAIL });
      expect(isBareAuthRecord(bare)).to.equal(true);

      const uid = await resolve(EMAIL);

      expect(uid).to.equal(MEMBER_UID);
      expect(await getUserOrNull(bare.uid)).to.equal(null);
      expect((await getAuth().getUser(MEMBER_UID)).email).to.equal(EMAIL);
    });

    const survivors: Array<{
      term: string;
      make: () => Promise<UserRecord>;
    }> = [
      {
        term: "a sign-in provider",
        make: () => getAuth().createUser({ email: EMAIL, password: "hunter2-hunter2" }),
      },
      {
        term: "a linked phone",
        make: () => getAuth().createUser({ email: EMAIL, phoneNumber: "+41790000001" }),
      },
      {
        term: "custom claims",
        make: async () => {
          const user = await getAuth().createUser({ email: EMAIL });
          await getAuth().setCustomUserClaims(user.uid, { admin: false });
          return getAuth().getUser(user.uid);
        },
      },
    ];
    for (const { term, make } of survivors) {
      it(`never deletes a record with ${term} — login fails instead`, async () => {
        await seedUserDoc(MEMBER_UID);
        const holder = await make();
        expect(isBareAuthRecord(holder)).to.equal(false);

        await expectHttpsError(() => resolve(EMAIL), "failed-precondition");

        expect(await getUserOrNull(holder.uid)).to.not.equal(null);
        expect(await getUserOrNull(MEMBER_UID)).to.equal(null);
      });
    }

    it("never deletes a record that has a users doc of its own", async () => {
      await seedUserDoc(MEMBER_UID);
      const holder = await getAuth().createUser({ uid: "other", email: EMAIL });
      await seedUserDoc("other", { email: "someone-else@example.com" });

      await expectHttpsError(() => resolve(EMAIL), "failed-precondition");

      expect(await getUserOrNull(holder.uid)).to.not.equal(null);
    });

    it("does not treat a kiosk tag: principal as bare", async () => {
      const tagUser = await getAuth().createUser({ uid: "tag:member-1:abc" });
      expect(isBareAuthRecord(tagUser)).to.equal(false);
    });
  });

  describe("Auth fallback", () => {
    it("returns the Auth uid when no users doc knows the e-mail", async () => {
      const authUser = await getAuth().createUser({ email: EMAIL });

      expect(await resolve(EMAIL)).to.equal(authUser.uid);
    });

    it("returns the Auth uid when its users doc has no e-mail", async () => {
      await getAuth().createUser({ uid: MEMBER_UID, email: EMAIL });
      await seedUserDoc(MEMBER_UID, { email: null });

      expect(await resolve(EMAIL)).to.equal(MEMBER_UID);
    });

    it("never signs a stale Auth e-mail into the member's account", async () => {
      // An admin moved the member to a new address; Auth still has the old one.
      await seedUserDoc(MEMBER_UID, { email: "new@example.com" });
      await getAuth().createUser({ uid: MEMBER_UID, email: "old@example.com" });

      const uid = await resolve("old@example.com");

      expect(uid).to.not.equal(MEMBER_UID);
      expect((await getAuth().getUser(MEMBER_UID)).email).to.equal(
        "new@example.com"
      );
      expect((await getAuth().getUser(uid)).email).to.equal("old@example.com");
    });

    it("creates a fresh uid for an e-mail neither side knows", async () => {
      const uid = await resolve("newcomer@example.com");

      const user = await getAuth().getUser(uid);
      expect(user.email).to.equal("newcomer@example.com");
      expect(isBareAuthRecord(user)).to.equal(true);
    });
  });

  it("Auth stores e-mails lowercased — the rules create pin relies on it", async () => {
    const user = await getAuth().createUser({ email: "Mixed@Case.CH" });
    expect(user.email).to.equal("mixed@case.ch");
  });
});
