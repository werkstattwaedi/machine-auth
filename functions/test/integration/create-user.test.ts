// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Admin createUser: a bare Auth record holding the e-mail is ADOPTED, never
// deleted (ADR-0043); anything else holding it is a conflict.

import { expect } from "chai";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { createUserHandler } from "../../src/auth/create-user";

const EMAIL = "newmember@example.com";

function request(data: unknown): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: "admin-1", token: { admin: true } },
  } as unknown as CallableRequest<unknown>;
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

describe("createUser (Integration)", () => {
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

  it("creates Auth user + doc under one uid, with a normalized e-mail", async () => {
    const { uid } = await createUserHandler(
      request({ email: " NewMember@Example.com", firstName: "Nia", lastName: "Neu" })
    );

    expect((await getAuth().getUser(uid)).email).to.equal(EMAIL);
    const doc = await getFirestore().collection("users").doc(uid).get();
    expect(doc.get("email")).to.equal(EMAIL);
    expect(doc.get("roles")).to.deep.equal([]);
  });

  it("adopts a bare Auth record instead of deleting it", async () => {
    // Someone requested a login code for this address and never finished.
    const bare = await getAuth().createUser({ email: EMAIL });

    const { uid } = await createUserHandler(
      request({ email: EMAIL, firstName: "Nia", lastName: "Neu" })
    );

    expect(uid).to.equal(bare.uid);
    expect((await getAuth().getUser(uid)).displayName).to.equal("Nia Neu");
    const doc = await getFirestore().collection("users").doc(uid).get();
    expect(doc.exists).to.equal(true);
    expect((await getAuth().listUsers()).users).to.have.length(1);
  });

  it("refuses when a non-bare Auth record holds the e-mail", async () => {
    const holder = await getAuth().createUser({
      email: EMAIL,
      password: "hunter2-hunter2",
    });

    await expectHttpsError(
      () => createUserHandler(request({ email: EMAIL })),
      "already-exists"
    );

    expect((await getAuth().getUser(holder.uid)).email).to.equal(EMAIL);
    const docs = await getFirestore().collection("users").get();
    expect(docs.size).to.equal(0);
  });

  it("refuses when a users doc already carries the e-mail", async () => {
    await getFirestore().collection("users").doc("member-1").set({
      created: Timestamp.now(),
      email: EMAIL,
      roles: [],
      permissions: [],
    });

    await expectHttpsError(
      () => createUserHandler(request({ email: EMAIL })),
      "already-exists"
    );

    expect((await getAuth().listUsers()).users).to.have.length(0);
  });
});
