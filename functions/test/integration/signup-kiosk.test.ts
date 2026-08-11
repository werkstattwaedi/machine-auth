// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Covers signupKiosk + sendAccountInstructions (issue #595, ADR-0022
// amendment): account creation at the kiosk mints the synthetic-uid actsAs
// session (never a persistent one), refuses to touch existing profiles
// (imported members!), and the instructions email is offered/sent so the
// account isn't stranded on the shared terminal.

// Force emulator branch so requestLoginCode + the instructions email skip
// Resend (debugCode / log line instead).
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
  handleSignupKiosk,
  signupKioskHandler,
  type KioskSignupProfile,
} from "../../src/checkout/signup_kiosk";
import { sendAccountInstructionsHandler } from "../../src/checkout/account_instructions";

const ORIGIN = "http://localhost:5173";
const TEST_BEARER = "test-kiosk-bearer";

const PROFILE: KioskSignupProfile = {
  firstName: "Nora",
  lastName: "Neu",
  userType: "erwachsen",
  termsAccepted: true,
  billingAddress: null,
};

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

async function latestCodeConsumed(email: string): Promise<boolean> {
  const snap = await getFirestore()
    .collection("loginCodes")
    .where("email", "==", email)
    .orderBy("created", "desc")
    .limit(1)
    .get();
  return snap.docs[0].data().consumedAt != null;
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

describe("signupKiosk + sendAccountInstructions (Integration)", () => {
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

  describe("signupKiosk", () => {
    it("creates the account and mints a synthetic actsAs session", async () => {
      const code = await requestAndGetCode("nora@example.com");

      const result = await handleSignupKiosk({
        email: "nora@example.com",
        code,
        profile: PROFILE,
      });

      // Auth user + users doc exist, doc id == auth uid.
      const authUser = await getAuth().getUserByEmail("nora@example.com");
      const doc = await getFirestore()
        .collection("users")
        .doc(authUser.uid)
        .get();
      expect(doc.exists).to.equal(true);
      expect(doc.get("firstName")).to.equal("Nora");
      expect(doc.get("lastName")).to.equal("Neu");
      expect(doc.get("userType")).to.equal("erwachsen");
      expect(doc.get("termsAcceptedAt")).to.not.be.null;
      expect(doc.get("billingAddress")).to.be.null;
      expect(doc.get("roles")).to.deep.equal([]);
      expect(doc.get("permissions")).to.deep.equal([]);
      expect(doc.get("phone")).to.be.null;
      // The instructions email was "sent" (emulator: logged) and stamped.
      expect(result.emailSent).to.equal(true);
      expect(doc.get("accountInstructionsSentAt")).to.not.be.undefined;

      expect(result.userId).to.equal(authUser.uid);
      expect(result.firstName).to.equal("Nora");
      expect(result.activeMembership).to.equal(false);
      const { uid, claims } = decodeCustomToken(result.customToken);
      expect(uid).to.match(new RegExp(`^tag:${authUser.uid}:`));
      expect(claims.tagCheckout).to.equal(true);
      expect(claims.actsAs).to.equal(authUser.uid);
      // Distinguishes account creation from a plain sign-in in audit logs.
      expect(claims.method).to.equal("signup");
    });

    it("stores the billing address for a firma sign-up", async () => {
      const code = await requestAndGetCode("firma@example.com");

      await handleSignupKiosk({
        email: "firma@example.com",
        code,
        profile: {
          ...PROFILE,
          userType: "firma",
          billingAddress: {
            company: "Holz AG",
            street: "Gasse 1",
            zip: "8820",
            city: "Wädenswil",
          },
        },
      });

      const authUser = await getAuth().getUserByEmail("firma@example.com");
      const doc = await getFirestore()
        .collection("users")
        .doc(authUser.uid)
        .get();
      expect(doc.get("billingAddress")).to.deep.equal({
        company: "Holz AG",
        street: "Gasse 1",
        zip: "8820",
        city: "Wädenswil",
      });
    });

    it("rejects an invalid profile WITHOUT consuming the code", async () => {
      const code = await requestAndGetCode("invalid@example.com");

      await expectHttpsError(
        () =>
          handleSignupKiosk({
            email: "invalid@example.com",
            code,
            profile: { ...PROFILE, termsAccepted: false },
          }),
        "invalid-argument"
      );
      await expectHttpsError(
        () =>
          handleSignupKiosk({
            email: "invalid@example.com",
            code,
            profile: { ...PROFILE, firstName: "  " },
          }),
        "invalid-argument"
      );
      await expectHttpsError(
        () =>
          handleSignupKiosk({
            email: "invalid@example.com",
            code,
            profile: { ...PROFILE, userType: "firma" }, // no address
          }),
        "invalid-argument"
      );

      // The one-shot code survived every rejected attempt…
      expect(await latestCodeConsumed("invalid@example.com")).to.equal(false);
      // …so a corrected submit still works.
      const result = await handleSignupKiosk({
        email: "invalid@example.com",
        code,
        profile: PROFILE,
      });
      expect(result.userId).to.be.a("string");
    });

    it("refuses an existing profile (imported member) without burning the code", async () => {
      await getFirestore().collection("users").doc("importedUser").set({
        email: "imported@example.com",
        firstName: "Alt",
        lastName: "Mitglied",
        userType: "erwachsen",
        termsAcceptedAt: null,
      });
      const code = await requestAndGetCode("imported@example.com");

      await expectHttpsError(
        () =>
          handleSignupKiosk({
            email: "imported@example.com",
            code,
            profile: PROFILE,
          }),
        "failed-precondition",
        "existiert bereits ein Konto"
      );

      // The imported profile is untouched, no Auth user was created, and
      // the code is still usable (e.g. for a later own-device login).
      const doc = await getFirestore()
        .collection("users")
        .doc("importedUser")
        .get();
      expect(doc.get("firstName")).to.equal("Alt");
      try {
        await getAuth().getUserByEmail("imported@example.com");
        throw new Error("expected no Auth user to exist");
      } catch (err: any) {
        expect(err?.code).to.equal("auth/user-not-found");
      }
      expect(await latestCodeConsumed("imported@example.com")).to.equal(false);
    });

    it("propagates a wrong code as 'Code falsch.'", async () => {
      await requestAndGetCode("wrongcode@example.com");

      await expectHttpsError(
        () =>
          handleSignupKiosk({
            email: "wrongcode@example.com",
            code: "000000",
            profile: PROFILE,
          }),
        "failed-precondition",
        "Code falsch."
      );
    });

    it("gates the callable wrapper on the kiosk bearer (FUNCTIONS_EMULATOR off)", async () => {
      const code = await requestAndGetCode("bearer@example.com");
      process.env.FUNCTIONS_EMULATOR = "";

      await expectHttpsError(
        () =>
          signupKioskHandler({
            data: { email: "bearer@example.com", code, profile: PROFILE },
          } as CallableRequest<any>),
        "permission-denied"
      );
    });
  });

  describe("sendAccountInstructions (session-bound)", () => {
    /** A synthetic kiosk-session request acting on `userId`. */
    function kioskRequest(userId: string): CallableRequest<unknown> {
      return {
        data: {},
        auth: {
          uid: `tag:${userId}:nonce`,
          token: { tagCheckout: true, actsAs: userId },
        },
      } as unknown as CallableRequest<unknown>;
    }

    it("rejects calls without an established kiosk session", async () => {
      await expectHttpsError(
        () =>
          sendAccountInstructionsHandler({
            data: {},
          } as CallableRequest<unknown>),
        "unauthenticated"
      );
      // A REAL session (no actsAs claim) is not a kiosk session either.
      await expectHttpsError(
        () =>
          sendAccountInstructionsHandler({
            data: {},
            auth: { uid: "someUser", token: {} },
          } as unknown as CallableRequest<unknown>),
        "permission-denied"
      );
    });

    it("rejects a session whose user doc is gone, or has no e-mail", async () => {
      await expectHttpsError(
        () => sendAccountInstructionsHandler(kioskRequest("ghost")),
        "failed-precondition"
      );
      await getFirestore().collection("users").doc("kidAccount").set({
        email: null,
        firstName: "Kind",
      });
      await expectHttpsError(
        () => sendAccountInstructionsHandler(kioskRequest("kidAccount")),
        "failed-precondition"
      );
    });

    it("mails the session's own user once and throttles the re-send", async () => {
      await getFirestore().collection("users").doc("unclaimed1").set({
        email: "unclaimed@example.com",
        firstName: "Ursula",
        termsAcceptedAt: null,
      });

      const first = await sendAccountInstructionsHandler(
        kioskRequest("unclaimed1")
      );
      expect(first).to.deep.equal({ ok: true, throttled: false });
      const doc = await getFirestore()
        .collection("users")
        .doc("unclaimed1")
        .get();
      expect(doc.get("accountInstructionsSentAt")).to.not.be.undefined;

      const second = await sendAccountInstructionsHandler(
        kioskRequest("unclaimed1")
      );
      expect(second).to.deep.equal({ ok: true, throttled: true });
    });
  });
});
