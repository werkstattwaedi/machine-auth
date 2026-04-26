// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Force emulator branch so requestLoginCode skips Resend and writes debugCode.
process.env.FUNCTIONS_EMULATOR = "true";

import { expect } from "chai";
import { getAuth } from "firebase-admin/auth";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { handleRequestLoginCode } from "../../src/auth/login-code/request";
import { handleVerifyLoginCode } from "../../src/auth/login-code/verify-code";
import { handleVerifyMagicLink } from "../../src/auth/login-code/verify-link";

const ORIGIN = "http://localhost:5173";

async function findLatestCodeDoc(email: string) {
  const db = getFirestore();
  const snap = await db
    .collection("loginCodes")
    .where("email", "==", email)
    .orderBy("created", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

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

describe("Login code flow (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
    // Clean up Auth users between tests so createUser paths are exercised fresh.
    const auth = getAuth();
    const users = await auth.listUsers();
    await Promise.all(users.users.map((u) => auth.deleteUser(u.uid)));
  });

  describe("requestLoginCode", () => {
    it("writes a loginCodes doc with debugCode in emulator mode", async () => {
      await handleRequestLoginCode({ email: "alice@example.com" }, ORIGIN);

      const doc = await findLatestCodeDoc("alice@example.com");
      expect(doc).to.not.be.null;
      const data = doc!.data();
      expect(data.email).to.equal("alice@example.com");
      expect(data.codeHash).to.be.a("string");
      expect(data.debugCode).to.match(/^\d{6}$/);
      expect(data.attempts).to.equal(0);
      expect(data.consumedAt).to.equal(null);
      expect(data.expiresAt.toMillis()).to.be.greaterThan(Date.now());
    });

    it("rejects disallowed origins", async () => {
      await expectHttpsError(
        () => handleRequestLoginCode({ email: "a@b.ch" }, "https://evil.com"),
        "failed-precondition"
      );
    });

    it("surfaces a config error when LOGIN_ALLOWED_ORIGINS is empty in production-like mode", async () => {
      // Reproduces the production outage: when the param is unset/empty and
      // we're not in emulator mode, every login attempt should fail with the
      // distinct "not configured" error (not the generic "unknown request
      // origin"), so ops sees the misconfiguration in logs.
      const savedEmulator = process.env.FUNCTIONS_EMULATOR;
      const savedOrigins = process.env.LOGIN_ALLOWED_ORIGINS;
      delete process.env.FUNCTIONS_EMULATOR;
      process.env.LOGIN_ALLOWED_ORIGINS = "";
      try {
        try {
          await handleRequestLoginCode(
            { email: "ops@example.com" },
            "https://checkout.werkstattwaedi.ch"
          );
          throw new Error("expected HttpsError, got success");
        } catch (err: any) {
          expect(err?.code).to.equal("failed-precondition");
          expect(err?.message ?? "").to.contain("not configured");
        }
      } finally {
        if (savedEmulator === undefined) {
          delete process.env.FUNCTIONS_EMULATOR;
        } else {
          process.env.FUNCTIONS_EMULATOR = savedEmulator;
        }
        if (savedOrigins === undefined) {
          delete process.env.LOGIN_ALLOWED_ORIGINS;
        } else {
          process.env.LOGIN_ALLOWED_ORIGINS = savedOrigins;
        }
      }
    });

    it("rejects malformed email", async () => {
      await expectHttpsError(
        () => handleRequestLoginCode({ email: "not-an-email" }, ORIGIN),
        "invalid-argument"
      );
    });

    it("rate-limits a second request within 60 s", async () => {
      await handleRequestLoginCode({ email: "alice@example.com" }, ORIGIN);
      await expectHttpsError(
        () => handleRequestLoginCode({ email: "alice@example.com" }, ORIGIN),
        "resource-exhausted"
      );
    });

    it("invalidates the previous unconsumed code when a new one is issued", async () => {
      // First request, bypass rate limit by backdating.
      await handleRequestLoginCode({ email: "alice@example.com" }, ORIGIN);
      const firstDoc = await findLatestCodeDoc("alice@example.com");
      expect(firstDoc).to.not.be.null;
      await firstDoc!.ref.update({
        created: new Date(Date.now() - 2 * 60 * 1000),
      });

      await handleRequestLoginCode({ email: "alice@example.com" }, ORIGIN);

      const refreshed = await firstDoc!.ref.get();
      expect(refreshed.get("consumedAt")).to.not.be.null;
    });
  });

  describe("verifyLoginCode", () => {
    async function requestAndGetCode(email: string) {
      await handleRequestLoginCode({ email }, ORIGIN);
      const doc = await findLatestCodeDoc(email);
      return { docId: doc!.id, code: doc!.data().debugCode as string };
    }

    it("returns a custom token for the correct code and consumes the doc", async () => {
      const { docId, code } = await requestAndGetCode("bob@example.com");

      const result = await handleVerifyLoginCode({
        email: "bob@example.com",
        code,
      });
      expect(result.customToken).to.be.a("string");
      expect(result.customToken.length).to.be.greaterThan(20);

      const doc = await getFirestore().collection("loginCodes").doc(docId).get();
      expect(doc.get("consumedAt")).to.not.be.null;
    });

    it("creates an Auth user on first verification if none exists", async () => {
      const { code } = await requestAndGetCode("carol@example.com");
      await handleVerifyLoginCode({ email: "carol@example.com", code });

      const user = await getAuth().getUserByEmail("carol@example.com");
      expect(user.email).to.equal("carol@example.com");
    });

    it("rejects a wrong code and increments attempts", async () => {
      await requestAndGetCode("dave@example.com");

      await expectHttpsError(
        () => handleVerifyLoginCode({ email: "dave@example.com", code: "000000" }),
        "failed-precondition"
      );

      const doc = await findLatestCodeDoc("dave@example.com");
      expect(doc!.get("attempts")).to.equal(1);
      expect(doc!.get("consumedAt")).to.equal(null);
    });

    it("burns the doc after the 6th wrong attempt", async () => {
      await requestAndGetCode("eve@example.com");
      for (let i = 0; i < 5; i++) {
        await expectHttpsError(
          () => handleVerifyLoginCode({ email: "eve@example.com", code: "000000" }),
          "failed-precondition"
        );
      }
      // 6th attempt — doc should now be consumed regardless of code.
      await expectHttpsError(
        () => handleVerifyLoginCode({ email: "eve@example.com", code: "000000" }),
        "failed-precondition"
      );

      const doc = await findLatestCodeDoc("eve@example.com");
      expect(doc!.get("consumedAt")).to.not.be.null;
    });

    it("rejects an expired code", async () => {
      const { docId } = await requestAndGetCode("frank@example.com");
      // Backdate expiresAt so the check fails.
      await getFirestore()
        .collection("loginCodes")
        .doc(docId)
        .update({ expiresAt: new Date(Date.now() - 1_000) });

      const doc = await findLatestCodeDoc("frank@example.com");
      await expectHttpsError(
        () =>
          handleVerifyLoginCode({
            email: "frank@example.com",
            code: doc!.data().debugCode as string,
          }),
        "failed-precondition"
      );
    });

    it("rejects a code that's already been consumed", async () => {
      const { code } = await requestAndGetCode("grace@example.com");
      await handleVerifyLoginCode({ email: "grace@example.com", code });
      await expectHttpsError(
        () => handleVerifyLoginCode({ email: "grace@example.com", code }),
        "failed-precondition"
      );
    });
  });

  describe("verifyMagicLink", () => {
    it("redeems a valid token and consumes the doc", async () => {
      await handleRequestLoginCode({ email: "henry@example.com" }, ORIGIN);
      const doc = await findLatestCodeDoc("henry@example.com");

      const result = await handleVerifyMagicLink({ token: doc!.id });
      expect(result.customToken).to.be.a("string");

      const after = await doc!.ref.get();
      expect(after.get("consumedAt")).to.not.be.null;
    });

    it("rejects an unknown token", async () => {
      await expectHttpsError(
        () =>
          handleVerifyMagicLink({
            token: "x".repeat(32),
          }),
        "failed-precondition"
      );
    });

    it("rejects obviously malformed tokens", async () => {
      await expectHttpsError(
        () => handleVerifyMagicLink({ token: "short" }),
        "invalid-argument"
      );
    });

    it("rejects an already-consumed token", async () => {
      await handleRequestLoginCode({ email: "ivy@example.com" }, ORIGIN);
      const doc = await findLatestCodeDoc("ivy@example.com");
      await handleVerifyMagicLink({ token: doc!.id });

      await expectHttpsError(
        () => handleVerifyMagicLink({ token: doc!.id }),
        "failed-precondition"
      );
    });

    it("rejects an expired token", async () => {
      await handleRequestLoginCode({ email: "jack@example.com" }, ORIGIN);
      const doc = await findLatestCodeDoc("jack@example.com");
      // Backdate the expiry past now.
      await doc!.ref.update({ expiresAt: new Date(Date.now() - 1_000) });

      await expectHttpsError(
        () => handleVerifyMagicLink({ token: doc!.id }),
        "failed-precondition"
      );
    });
  });
});
