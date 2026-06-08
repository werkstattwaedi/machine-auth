// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Force emulator branch so the localhost origin is accepted.
process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { handleCheckAccountExists } from "../../src/auth/check-account-exists";

const ORIGIN = "http://localhost:5173";

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn();
    throw new Error(`expected HttpsError with code=${expectedCode}, got success`);
  } catch (err: any) {
    if (err?.code !== expectedCode) {
      throw new Error(
        `expected HttpsError code=${expectedCode}, got ${err?.code ?? "unknown"}: ${err?.message}`
      );
    }
  }
}

describe("checkAccountExists (Integration)", () => {
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

  it("reports exists=true for a completed account (terms accepted)", async () => {
    const auth = getAuth();
    const user = await auth.createUser({ email: "done@example.com" });
    await getFirestore().collection("users").doc(user.uid).set({
      email: "done@example.com",
      firstName: "Done",
      lastName: "User",
      termsAcceptedAt: Timestamp.now(),
    });

    const result = await handleCheckAccountExists(
      { email: "done@example.com" },
      ORIGIN
    );
    expect(result.exists).to.equal(true);
    expect(result.hasAuthUser).to.equal(true);
  });

  it("reports exists=false but hasAuthUser=true for an unfinished signup", async () => {
    const auth = getAuth();
    const user = await auth.createUser({ email: "half@example.com" });
    // Doc exists but terms not accepted (e.g. admin-created or abandoned).
    await getFirestore().collection("users").doc(user.uid).set({
      email: "half@example.com",
      firstName: "",
      lastName: "",
      termsAcceptedAt: null,
    });

    const result = await handleCheckAccountExists(
      { email: "half@example.com" },
      ORIGIN
    );
    expect(result.exists).to.equal(false);
    expect(result.hasAuthUser).to.equal(true);
  });

  it("reports exists=false for a brand-new email", async () => {
    const result = await handleCheckAccountExists(
      { email: "nobody@example.com" },
      ORIGIN
    );
    expect(result.exists).to.equal(false);
    expect(result.hasAuthUser).to.equal(false);
  });

  it("normalizes the email before lookup", async () => {
    const auth = getAuth();
    const user = await auth.createUser({ email: "mixed@example.com" });
    await getFirestore().collection("users").doc(user.uid).set({
      email: "mixed@example.com",
      firstName: "Mixed",
      lastName: "Case",
      termsAcceptedAt: Timestamp.now(),
    });

    const result = await handleCheckAccountExists(
      { email: "  MiXeD@Example.com " },
      ORIGIN
    );
    expect(result.exists).to.equal(true);
  });

  it("rejects a disallowed origin", async () => {
    await expectHttpsError(
      () => handleCheckAccountExists({ email: "a@b.ch" }, "https://evil.com"),
      "failed-precondition"
    );
  });

  it("rejects a malformed email", async () => {
    await expectHttpsError(
      () => handleCheckAccountExists({ email: "not-an-email" }, ORIGIN),
      "invalid-argument"
    );
  });
});
