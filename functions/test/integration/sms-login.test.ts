// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// SMS login codes (ADR-0031): the phone-account lookup and the kiosk
// token exchange. Force the emulator branch so the localhost origin and
// the bearer skip apply.
process.env.FUNCTIONS_EMULATOR = "true";

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
import { handleCheckPhoneAccountExists } from "../../src/auth/check-account-exists";
import {
  handleExchangeKioskSession,
  type ExchangeKioskSessionInput,
} from "../../src/checkout/exchange_kiosk_session";

const ORIGIN = "http://localhost:5173";
const PHONE = "+41791234567";

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

/** Minimal CallableRequest shape for handler-level invocation. */
function exchangeRequest(
  auth: CallableRequest["auth"] | undefined
): CallableRequest<ExchangeKioskSessionInput> {
  return {
    data: { bearer: undefined },
    auth,
    rawRequest: { headers: {} },
  } as unknown as CallableRequest<ExchangeKioskSessionInput>;
}

function phoneAuthContext(uid: string, overrides?: Record<string, unknown>) {
  return {
    uid,
    token: {
      firebase: { sign_in_provider: "phone" },
      ...overrides,
    },
  } as unknown as CallableRequest["auth"];
}

describe("SMS login (Integration)", () => {
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

  describe("checkPhoneAccountExists", () => {
    it("finds a completed account by the AUTH-LINKED phone number", async () => {
      const user = await getAuth().createUser({
        email: "sms@example.com",
        phoneNumber: PHONE,
      });
      await getFirestore().collection("users").doc(user.uid).set({
        email: "sms@example.com",
        firstName: "Sms",
        lastName: "User",
        termsAcceptedAt: Timestamp.now(),
      });

      const result = await handleCheckPhoneAccountExists({ phone: PHONE }, ORIGIN);
      expect(result.exists).to.equal(true);
      expect(result.hasAuthUser).to.equal(true);
    });

    it("ignores the free-text users.phone field — only the linked number counts", async () => {
      // A user typed the number into their profile but never verified it.
      const user = await getAuth().createUser({ email: "typed@example.com" });
      await getFirestore().collection("users").doc(user.uid).set({
        email: "typed@example.com",
        firstName: "Typed",
        lastName: "Only",
        phone: PHONE,
        termsAcceptedAt: Timestamp.now(),
      });

      const result = await handleCheckPhoneAccountExists({ phone: PHONE }, ORIGIN);
      expect(result.exists).to.equal(false);
      expect(result.hasAuthUser).to.equal(false);
    });

    it("reports exists=false for a linked number without a completed doc", async () => {
      await getAuth().createUser({ phoneNumber: PHONE });
      const result = await handleCheckPhoneAccountExists({ phone: PHONE }, ORIGIN);
      expect(result.exists).to.equal(false);
      expect(result.hasAuthUser).to.equal(true);
    });

    it("rejects a non-E.164 phone", async () => {
      await expectHttpsError(
        () => handleCheckPhoneAccountExists({ phone: "079 123 45 67" }, ORIGIN),
        "invalid-argument"
      );
    });

    it("rejects a disallowed origin", async () => {
      await expectHttpsError(
        () => handleCheckPhoneAccountExists({ phone: PHONE }, "https://evil.com"),
        "failed-precondition"
      );
    });
  });

  describe("exchangeKioskSession", () => {
    it("mints the synthetic actsAs token for a completed phone principal", async () => {
      const user = await getAuth().createUser({
        email: "kiosk-sms@example.com",
        phoneNumber: PHONE,
      });
      await getFirestore().collection("users").doc(user.uid).set({
        email: "kiosk-sms@example.com",
        firstName: "Kiosk",
        lastName: "Sms",
        userType: "erwachsen",
        termsAcceptedAt: Timestamp.now(),
      });

      const result = await handleExchangeKioskSession(
        exchangeRequest(phoneAuthContext(user.uid))
      );
      expect(result.userId).to.equal(user.uid);
      expect(result.firstName).to.equal("Kiosk");
      expect(result.customToken).to.be.a("string").and.not.empty;
      // The custom token's synthetic uid must NOT be the real user — decode
      // the JWT payload (unverified parse is fine for a structural check).
      const payload = JSON.parse(
        Buffer.from(result.customToken.split(".")[1], "base64url").toString()
      );
      expect(payload.uid).to.match(new RegExp(`^tag:${user.uid}:`));
      expect(payload.claims).to.include({
        tagCheckout: true,
        actsAs: user.uid,
        method: "smsCode",
      });
    });

    it("rejects unauthenticated callers", async () => {
      await expectHttpsError(
        () => handleExchangeKioskSession(exchangeRequest(undefined)),
        "unauthenticated"
      );
    });

    it("rejects non-phone providers (no generic session escalation)", async () => {
      const user = await getAuth().createUser({ email: "mail@example.com" });
      await expectHttpsError(
        () =>
          handleExchangeKioskSession(
            exchangeRequest({
              uid: user.uid,
              token: { firebase: { sign_in_provider: "password" } },
            } as unknown as CallableRequest["auth"])
          ),
        "failed-precondition"
      );
    });

    it("rejects an actsAs kiosk principal (no chaining)", async () => {
      await expectHttpsError(
        () =>
          handleExchangeKioskSession(
            exchangeRequest(
              phoneAuthContext("tag:u1:x", { tagCheckout: true })
            )
          ),
        "failed-precondition"
      );
    });

    it("rejects a phone principal without a completed user doc", async () => {
      const user = await getAuth().createUser({ phoneNumber: PHONE });
      await expectHttpsError(
        () =>
          handleExchangeKioskSession(exchangeRequest(phoneAuthContext(user.uid))),
        "failed-precondition"
      );
    });
  });
});
