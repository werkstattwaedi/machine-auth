// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Covers verifyLoginCodeKiosk — the kiosk email-code sign-in (ADR-0022):
// consumes a login code like verifyLoginCode but mints the synthetic-uid
// actsAs session instead of a real one, and NEVER auto-creates an Auth user.

// Force emulator branch so requestLoginCode skips Resend and writes debugCode.
process.env.FUNCTIONS_EMULATOR = "true";
process.env.LOGIN_PER_EMAIL_WINDOW_MS =
  process.env.LOGIN_PER_EMAIL_WINDOW_MS ?? "86400000";
process.env.LOGIN_MAX_CODES_PER_EMAIL =
  process.env.LOGIN_MAX_CODES_PER_EMAIL ?? "20";
process.env.LOGIN_MAX_ATTEMPTS_PER_EMAIL =
  process.env.LOGIN_MAX_ATTEMPTS_PER_EMAIL ?? "30";

import { expect } from "chai";
import { getAuth } from "firebase-admin/auth";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getFirestore,
} from "../emulator-helper";
import { handleRequestLoginCode } from "../../src/auth/login-code/request";
import {
  handleVerifyLoginCodeKiosk,
  verifyLoginCodeKioskHandler,
} from "../../src/checkout/verify_login_code_kiosk";

const ORIGIN = "http://localhost:5173";
const TEST_BEARER = "test-kiosk-bearer";

/** Decode the (emulator-signed) custom-token JWT payload. */
function decodeCustomToken(token: string): {
  uid: string;
  claims: Record<string, unknown>;
} {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8")
  );
  return { uid: payload.uid, claims: payload.claims ?? {} };
}

async function requestAndGetCode(email: string): Promise<string> {
  await handleRequestLoginCode({ email }, ORIGIN);
  const snap = await getFirestore()
    .collection("loginCodes")
    .where("email", "==", email)
    .orderBy("created", "desc")
    .limit(1)
    .get();
  return snap.docs[0].data().debugCode as string;
}

async function expectHttpsError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  messageContains?: string
): Promise<void> {
  try {
    await fn();
    throw new Error(`expected HttpsError code=${expectedCode}, got success`);
  } catch (err: any) {
    expect(err?.code).to.equal(expectedCode);
    if (messageContains) {
      expect(err?.message ?? "").to.contain(messageContains);
    }
  }
}

describe("verifyLoginCodeKiosk (Integration)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
    for (const k of ["KIOSK_BEARER_KEY", "FUNCTIONS_EMULATOR"]) {
      savedEnv[k] = process.env[k];
    }
    process.env.KIOSK_BEARER_KEY = TEST_BEARER;
  });

  after(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await teardownEmulator();
  });

  beforeEach(async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    await clearFirestore();
    const auth = getAuth();
    const users = await auth.listUsers();
    await Promise.all(users.users.map((u) => auth.deleteUser(u.uid)));
  });

  async function seedCompletedUser(
    userId: string,
    email: string,
    extra: Record<string, unknown> = {}
  ) {
    await getFirestore().collection("users").doc(userId).set({
      email,
      firstName: "Kiosk",
      lastName: "Tester",
      userType: "erwachsen",
      termsAcceptedAt: new Date(),
      ...extra,
    });
  }

  it("mints a synthetic actsAs session for a completed account", async () => {
    await seedCompletedUser("kioskUser1", "kiosk@example.com");
    const code = await requestAndGetCode("kiosk@example.com");

    const result = await handleVerifyLoginCodeKiosk({
      email: "kiosk@example.com",
      code,
    });

    expect(result.userId).to.equal("kioskUser1");
    expect(result.firstName).to.equal("Kiosk");
    expect(result.lastName).to.equal("Tester");
    expect(result.email).to.equal("kiosk@example.com");
    expect(result.userType).to.equal("erwachsen");
    expect(result.activeMembership).to.equal(false);

    const { uid, claims } = decodeCustomToken(result.customToken);
    expect(uid).to.match(/^tag:kioskUser1:/);
    expect(claims.tagCheckout).to.equal(true);
    expect(claims.actsAs).to.equal("kioskUser1");
    expect(claims.method).to.equal("emailCode");
  });

  it("collapses an activeMembership reference to a boolean", async () => {
    const db = getFirestore();
    await seedCompletedUser("memberUser", "member@example.com", {
      activeMembership: db.doc("memberships/m1"),
    });
    const code = await requestAndGetCode("member@example.com");

    const result = await handleVerifyLoginCodeKiosk({
      email: "member@example.com",
      code,
    });
    expect(result.activeMembership).to.equal(true);
  });

  it("consumes the code — a second verify fails", async () => {
    await seedCompletedUser("kioskUser2", "once@example.com");
    const code = await requestAndGetCode("once@example.com");

    await handleVerifyLoginCodeKiosk({ email: "once@example.com", code });
    await expectHttpsError(
      () => handleVerifyLoginCodeKiosk({ email: "once@example.com", code }),
      "failed-precondition",
      "Code bereits verwendet."
    );
  });

  it("rejects an unknown email WITHOUT creating an Auth user", async () => {
    const code = await requestAndGetCode("stranger@example.com");

    await expectHttpsError(
      () =>
        handleVerifyLoginCodeKiosk({ email: "stranger@example.com", code }),
      "failed-precondition",
      "Kein abgeschlossenes Konto"
    );

    // The critical no-auto-create invariant (mintSessionToken would have
    // created one).
    try {
      await getAuth().getUserByEmail("stranger@example.com");
      throw new Error("expected no Auth user to exist");
    } catch (err: any) {
      expect(err?.code).to.equal("auth/user-not-found");
    }
  });

  it("rejects an incomplete account (termsAcceptedAt missing)", async () => {
    await getFirestore().collection("users").doc("halfDone").set({
      email: "half@example.com",
      firstName: "Half",
    });
    const code = await requestAndGetCode("half@example.com");

    await expectHttpsError(
      () => handleVerifyLoginCodeKiosk({ email: "half@example.com", code }),
      "failed-precondition",
      "Kein abgeschlossenes Konto"
    );
  });

  it("propagates a wrong code as 'Code falsch.'", async () => {
    await seedCompletedUser("kioskUser3", "wrong@example.com");
    await requestAndGetCode("wrong@example.com");

    await expectHttpsError(
      () =>
        handleVerifyLoginCodeKiosk({
          email: "wrong@example.com",
          code: "000000",
        }),
      "failed-precondition",
      "Code falsch."
    );
  });

  describe("callable wrapper bearer gate (FUNCTIONS_EMULATOR off)", () => {
    function makeRequest(data: {
      email: string;
      code: string;
      bearer?: string;
    }): CallableRequest<{ email: string; code: string; bearer?: string }> {
      return { data } as CallableRequest<{
        email: string;
        code: string;
        bearer?: string;
      }>;
    }

    it("rejects a missing/wrong bearer with permission-denied", async () => {
      process.env.FUNCTIONS_EMULATOR = "";
      await expectHttpsError(
        () =>
          verifyLoginCodeKioskHandler(
            makeRequest({ email: "a@b.ch", code: "123456" })
          ),
        "permission-denied"
      );
      await expectHttpsError(
        () =>
          verifyLoginCodeKioskHandler(
            makeRequest({ email: "a@b.ch", code: "123456", bearer: "nope" })
          ),
        "permission-denied"
      );
    });

    it("accepts the correct bearer and proceeds", async () => {
      await seedCompletedUser("kioskUser4", "bearer@example.com");
      const code = await requestAndGetCode("bearer@example.com");

      process.env.FUNCTIONS_EMULATOR = "";
      const result = await verifyLoginCodeKioskHandler(
        makeRequest({
          email: "bearer@example.com",
          code,
          bearer: TEST_BEARER,
        })
      );
      expect(result.userId).to.equal("kioskUser4");
    });
  });
});
