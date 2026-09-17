// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Body of the `syncAuthIdentity` users trigger (ADR-0043, issue #633).
// Firestore triggers do not run in this suite, so `reconcileAuthIdentity`
// is called directly, the way the trigger calls it: with the uid only.

import { expect } from "chai";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import {
  defaultIdentityDeps,
  reconcileAuthIdentity,
} from "../../src/auth/identity";

const UID = "member-1";
const EMAIL = "member@example.com";
const PHONE = "+41790000001";

async function writeUserDoc(fields: Record<string, unknown>): Promise<void> {
  await getFirestore()
    .collection("users")
    .doc(UID)
    .set(
      {
        created: Timestamp.now(),
        firstName: "Mia",
        lastName: "Member",
        roles: [],
        permissions: [],
        ...fields,
      },
      { merge: true }
    );
}

describe("reconcileAuthIdentity (Integration)", () => {
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

  const reconcile = () => reconcileAuthIdentity(defaultIdentityDeps(), UID);

  describe("e-mail", () => {
    it("propagates a changed doc e-mail to Auth", async () => {
      await getAuth().createUser({ uid: UID, email: "old@example.com" });
      await writeUserDoc({ email: EMAIL });

      await reconcile();

      expect((await getAuth().getUser(UID)).email).to.equal(EMAIL);
    });

    it("acts on the current doc, not on the event that woke it", async () => {
      // Two writes, one (late) invocation: a stale event must not be able
      // to put Auth back onto the first value.
      await getAuth().createUser({ uid: UID, email: "old@example.com" });
      await writeUserDoc({ email: "first@example.com" });
      await writeUserDoc({ email: EMAIL });

      await reconcile();

      expect((await getAuth().getUser(UID)).email).to.equal(EMAIL);
    });

    it("is a no-op when Auth already matches", async () => {
      await getAuth().createUser({ uid: UID, email: EMAIL, phoneNumber: PHONE });
      await writeUserDoc({ email: EMAIL, phone: PHONE });
      const before = await getAuth().getUser(UID);

      await reconcile();

      const after = await getAuth().getUser(UID);
      expect(after.toJSON()).to.deep.equal(before.toJSON());
    });

    it("only logs when a non-bare record holds the doc's e-mail", async () => {
      await getAuth().createUser({ uid: UID, email: "old@example.com" });
      await getAuth().createUser({
        uid: "other",
        email: EMAIL,
        password: "hunter2-hunter2",
      });
      await writeUserDoc({ email: EMAIL });

      await reconcile(); // must not throw

      expect((await getAuth().getUser(UID)).email).to.equal("old@example.com");
      expect((await getAuth().getUser("other")).email).to.equal(EMAIL);
    });

    it("leaves an e-mail-less doc (managed member) alone", async () => {
      await getAuth().createUser({ uid: UID, disabled: true });
      await writeUserDoc({ email: null });

      await reconcile();

      const user = await getAuth().getUser(UID);
      expect(user.email).to.equal(undefined);
      expect(user.disabled).to.equal(true);
    });
  });

  describe("phone", () => {
    it("unlinks an Auth phone the doc no longer names", async () => {
      await getAuth().createUser({ uid: UID, email: EMAIL, phoneNumber: PHONE });
      await writeUserDoc({ email: EMAIL, phone: "+41790000002" });

      await reconcile();

      expect((await getAuth().getUser(UID)).phoneNumber).to.equal(undefined);
    });

    it("unlinks when the doc phone was cleared", async () => {
      await getAuth().createUser({ uid: UID, email: EMAIL, phoneNumber: PHONE });
      await writeUserDoc({ email: EMAIL, phone: null });

      await reconcile();

      expect((await getAuth().getUser(UID)).phoneNumber).to.equal(undefined);
    });

    it("keeps the link while the doc names the same number", async () => {
      await getAuth().createUser({ uid: UID, email: EMAIL, phoneNumber: PHONE });
      await writeUserDoc({ email: EMAIL, phone: PHONE });

      await reconcile();

      expect((await getAuth().getUser(UID)).phoneNumber).to.equal(PHONE);
    });
  });

  it("does nothing — and creates nothing — without an Auth record", async () => {
    await writeUserDoc({ email: EMAIL });

    await reconcile();

    const users = await getAuth().listUsers();
    expect(users.users).to.have.length(0);
  });

  it("does nothing once the doc is gone", async () => {
    await getAuth().createUser({ uid: UID, email: EMAIL, phoneNumber: PHONE });

    await reconcile();

    const user = await getAuth().getUser(UID);
    expect(user.email).to.equal(EMAIL);
    expect(user.phoneNumber).to.equal(PHONE);
  });
});
