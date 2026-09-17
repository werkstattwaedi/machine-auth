// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Admin e-mail change: Auth and the users doc move together (ADR-0043).

import { expect } from "chai";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
  importIdleBareUser,
} from "../emulator-helper";
import {
  changeUserEmail,
  updateUserEmailHandler,
} from "../../src/auth/update-user-email";

const UID = "member-1";
const OLD_EMAIL = "old@example.com";
const NEW_EMAIL = "new@example.com";

function request(data: unknown, admin = true): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: "admin-1", token: { admin } },
  } as unknown as CallableRequest<unknown>;
}

async function seedMember(
  uid: string,
  email: string | null,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await getFirestore()
    .collection("users")
    .doc(uid)
    .set({
      created: Timestamp.now(),
      email,
      firstName: "Mia",
      lastName: "Member",
      roles: [],
      permissions: [],
      ...overrides,
    });
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

describe("updateUserEmail (Integration)", () => {
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

  it("rejects callers without the admin claim", async () => {
    await seedMember(UID, OLD_EMAIL);
    await expectHttpsError(
      () => updateUserEmailHandler(request({ uid: UID, email: NEW_EMAIL }, false)),
      "permission-denied"
    );
  });

  it("updates Auth and the doc together, normalizing the input", async () => {
    await seedMember(UID, OLD_EMAIL);
    await getAuth().createUser({ uid: UID, email: OLD_EMAIL });

    await updateUserEmailHandler(
      request({ uid: UID, email: "  New@Example.COM " })
    );

    expect((await getAuth().getUser(UID)).email).to.equal(NEW_EMAIL);
    const doc = await getFirestore().collection("users").doc(UID).get();
    expect(doc.get("email")).to.equal(NEW_EMAIL);
    expect(doc.get("modifiedBy")).to.equal("admin-1");
  });

  it("promotes a managed member: Auth gets the e-mail and is enabled", async () => {
    await seedMember(UID, null);
    await getAuth().createUser({ uid: UID, disabled: true });

    await updateUserEmailHandler(request({ uid: UID, email: NEW_EMAIL }));

    const user = await getAuth().getUser(UID);
    expect(user.email).to.equal(NEW_EMAIL);
    expect(user.disabled).to.equal(false);
  });

  it("reclaims the address from an idle bare Auth record", async () => {
    await seedMember(UID, OLD_EMAIL);
    await getAuth().createUser({ uid: UID, email: OLD_EMAIL });
    await importIdleBareUser("squatter", NEW_EMAIL);

    await updateUserEmailHandler(request({ uid: UID, email: NEW_EMAIL }));

    expect((await getAuth().getUser(UID)).email).to.equal(NEW_EMAIL);
    const users = await getAuth().listUsers();
    expect(users.users.map((u) => u.uid)).to.not.include("squatter");
  });

  it("asks the admin to retry later when a FRESH bare record holds the address", async () => {
    // Someone just started a sign-up with this address; their record frees
    // itself up. "Used by another account" would be a wild-goose chase.
    await seedMember(UID, OLD_EMAIL);
    await getAuth().createUser({ uid: UID, email: OLD_EMAIL });
    const fresh = await getAuth().createUser({ email: NEW_EMAIL });

    try {
      await updateUserEmailHandler(request({ uid: UID, email: NEW_EMAIL }));
      throw new Error("expected a refusal");
    } catch (err: any) {
      expect(err.code).to.equal("failed-precondition");
      expect(err.message).to.match(/zwei Stunden/);
    }

    expect((await getAuth().getUser(fresh.uid)).email).to.equal(NEW_EMAIL);
    expect((await getAuth().getUser(UID)).email).to.equal(OLD_EMAIL);
    const doc = await getFirestore().collection("users").doc(UID).get();
    expect(doc.get("email")).to.equal(OLD_EMAIL);
  });

  it("moves Auth back when the users doc write fails", async () => {
    // Auth moves first so a conflict aborts before the doc changes. If the
    // doc write then fails, Auth must not stay on the new address: the doc
    // is canonical, and a login with the new address would otherwise be
    // treated as a stranger and minted a second uid.
    await seedMember(UID, OLD_EMAIL);
    await getAuth().createUser({ uid: UID, email: OLD_EMAIL });

    const realDb = getFirestore();
    const failingDoc = (ref: FirebaseFirestore.DocumentReference) =>
      new Proxy(ref, {
        get(target, prop) {
          if (prop === "update") {
            return async () => {
              throw new Error("simulated Firestore outage");
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const db = new Proxy(realDb, {
      get(target, prop) {
        if (prop === "collection") {
          return (name: string) => {
            const col = target.collection(name);
            return new Proxy(col, {
              get(colTarget, colProp) {
                if (colProp === "doc") {
                  return (id: string) => failingDoc(colTarget.doc(id));
                }
                const value = Reflect.get(colTarget, colProp);
                return typeof value === "function"
                  ? value.bind(colTarget)
                  : value;
              },
            });
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expectHttpsError(
      () =>
        changeUserEmail(
          { auth: getAuth(), db },
          { uid: UID, email: NEW_EMAIL, actorUid: "admin-1" }
        ),
      "internal"
    );

    expect((await getAuth().getUser(UID)).email).to.equal(OLD_EMAIL);
    const doc = await realDb.collection("users").doc(UID).get();
    expect(doc.get("email")).to.equal(OLD_EMAIL);
  });

  it("refuses an e-mail another users doc carries — nothing moves", async () => {
    await seedMember(UID, OLD_EMAIL);
    await getAuth().createUser({ uid: UID, email: OLD_EMAIL });
    await seedMember("member-2", NEW_EMAIL);

    await expectHttpsError(
      () => updateUserEmailHandler(request({ uid: UID, email: NEW_EMAIL })),
      "already-exists"
    );

    expect((await getAuth().getUser(UID)).email).to.equal(OLD_EMAIL);
    const doc = await getFirestore().collection("users").doc(UID).get();
    expect(doc.get("email")).to.equal(OLD_EMAIL);
  });

  it("refuses an e-mail a non-bare Auth record holds — nothing moves", async () => {
    await seedMember(UID, OLD_EMAIL);
    await getAuth().createUser({ uid: UID, email: OLD_EMAIL });
    const holder = await getAuth().createUser({
      email: NEW_EMAIL,
      password: "hunter2-hunter2",
    });

    await expectHttpsError(
      () => updateUserEmailHandler(request({ uid: UID, email: NEW_EMAIL })),
      "already-exists"
    );

    expect((await getAuth().getUser(holder.uid)).email).to.equal(NEW_EMAIL);
    const doc = await getFirestore().collection("users").doc(UID).get();
    expect(doc.get("email")).to.equal(OLD_EMAIL);
  });

  it("rejects an empty or implausible e-mail and an unknown uid", async () => {
    await seedMember(UID, OLD_EMAIL);
    await expectHttpsError(
      () => updateUserEmailHandler(request({ uid: UID, email: "" })),
      "invalid-argument"
    );
    await expectHttpsError(
      () => updateUserEmailHandler(request({ uid: UID, email: "not-an-email" })),
      "invalid-argument"
    );
    await expectHttpsError(
      () => updateUserEmailHandler(request({ uid: "ghost", email: NEW_EMAIL })),
      "not-found"
    );
  });
});
