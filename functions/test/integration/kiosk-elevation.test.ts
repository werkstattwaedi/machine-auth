// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Kiosk step-up (ADR-0041): an actsAs session gains `elevatedUntil` only
// after an OTP bound to the account's own contact address, and only an
// elevated session may call the membership callables.

process.env.FUNCTIONS_EMULATOR = "true";
process.env.LOGIN_PER_EMAIL_WINDOW_MS =
  process.env.LOGIN_PER_EMAIL_WINDOW_MS ?? "86400000";
process.env.LOGIN_MAX_CODES_PER_EMAIL =
  process.env.LOGIN_MAX_CODES_PER_EMAIL ?? "20";
process.env.LOGIN_MAX_ATTEMPTS_PER_EMAIL =
  process.env.LOGIN_MAX_ATTEMPTS_PER_EMAIL ?? "30";
process.env.KIOSK_ELEVATION_TTL_MS =
  process.env.KIOSK_ELEVATION_TTL_MS ?? "900000";

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
import {
  handleGetKioskElevationOptions,
  handleRequestKioskElevation,
  handleVerifyKioskElevation,
  maskEmail,
  maskPhone,
} from "../../src/checkout/kiosk_elevation";
import { handleVerifyLoginCodeKiosk } from "../../src/checkout/verify_login_code_kiosk";
import { handleExchangeKioskSession } from "../../src/checkout/exchange_kiosk_session";
import { handleRequestLoginCode } from "../../src/auth/login-code/request";
import {
  mintKioskSessionToken,
  requireElevatedActsAs,
} from "../../src/checkout/kiosk_session";
import { callerUserRef, callerEmail } from "../../src/membership/shared";
import { handlePurchaseMembership } from "../../src/membership/purchase";
import type { CatalogEntity } from "../../src/types/firestore_entities";

const ORIGIN = "http://localhost:5173";
const PHONE = "+41791234528";

function decodeCustomToken(token: string): {
  uid: string;
  claims: Record<string, unknown>;
} {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8")
  );
  return { uid: payload.uid, claims: payload.claims ?? {} };
}

/** A CallableRequest carrying a kiosk session's claims (as the ID token would). */
function kioskRequest<T>(
  uid: string,
  claims: Record<string, unknown>,
  data: T
): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: claims },
    rawRequest: { headers: { origin: ORIGIN } },
  } as unknown as CallableRequest<T>;
}

async function latestCode(email: string): Promise<string> {
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

async function seedUser(
  userId: string,
  email: string,
  extra: Record<string, unknown> = {}
) {
  await getFirestore().collection("users").doc(userId).set({
    email,
    firstName: "Kiosk",
    lastName: "Tester",
    userType: "erwachsen",
    roles: [],
    permissions: [],
    termsAcceptedAt: Timestamp.now(),
    activeMembership: null,
    created: Timestamp.now(),
    ...extra,
  });
}

/** Badge-tap flavour: plain actsAs session, no elevation. */
async function badgeSession(userId: string) {
  const { customToken, elevatedUntil } = await mintKioskSessionToken(
    userId,
    "tag"
  );
  expect(elevatedUntil).to.equal(null);
  return decodeCustomToken(customToken);
}

describe("Kiosk step-up elevation (Integration)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    await clearFirestore();
    const auth = getAuth();
    const users = await auth.listUsers();
    await Promise.all(users.users.map((u) => auth.deleteUser(u.uid)));
  });

  describe("masking", () => {
    it("masks e-mail and phone for the interstitial", () => {
      expect(maskEmail("michschn@gmail.com")).to.equal("mi•••@gm•••.com");
      expect(maskEmail("ab@c.ch")).to.equal("ab•••@c•••.ch");
      expect(maskPhone("+41791234528")).to.equal("+41 79 ••• •• 28");
    });
  });

  describe("mint paths", () => {
    it("badge tap mints WITHOUT elevatedUntil; code sign-in mints WITH it", async () => {
      await seedUser("u1", "u1@example.com");
      const tag = await badgeSession("u1");
      expect(tag.claims).to.not.have.property("elevatedUntil");

      await handleRequestLoginCode({ email: "u1@example.com" }, ORIGIN);
      const code = await latestCode("u1@example.com");
      const result = await handleVerifyLoginCodeKiosk({
        email: "u1@example.com",
        code,
      });
      const { claims } = decodeCustomToken(result.customToken);
      expect(claims.elevatedUntil).to.be.a("number");
      expect(result.elevatedUntil).to.equal(claims.elevatedUntil);
      expect(claims.elevatedUntil as number).to.be.greaterThan(Date.now());
      expect(claims.elevatedUntil as number).to.be.at.most(
        Date.now() + 15 * 60 * 1000 + 1000
      );
    });

    it("SMS exchange mints elevated and honours expectedUserId", async () => {
      const user = await getAuth().createUser({
        email: "sms@example.com",
        phoneNumber: PHONE,
      });
      await seedUser(user.uid, "sms@example.com");
      const phoneAuth = (data: Record<string, unknown>) =>
        ({
          data,
          auth: {
            uid: user.uid,
            token: { firebase: { sign_in_provider: "phone" } },
          },
          rawRequest: { headers: {} },
        }) as unknown as CallableRequest<{ bearer?: string; expectedUserId?: string }>;

      const ok = await handleExchangeKioskSession(
        phoneAuth({ expectedUserId: user.uid })
      );
      expect(decodeCustomToken(ok.customToken).claims.elevatedUntil).to.be.a(
        "number"
      );
      expect(ok.elevatedUntil).to.be.a("number");

      await expectHttpsError(
        () => handleExchangeKioskSession(phoneAuth({ expectedUserId: "someone-else" })),
        "failed-precondition",
        "anderen Konto"
      );
    });
  });

  describe("getKioskElevationOptions", () => {
    it("returns masked e-mail and the Auth-linked phone", async () => {
      const user = await getAuth().createUser({
        email: "opts@example.com",
        phoneNumber: PHONE,
      });
      await seedUser(user.uid, "opts@example.com");
      const session = await badgeSession(user.uid);

      const options = await handleGetKioskElevationOptions(
        kioskRequest(session.uid, session.claims, {})
      );
      expect(options.email).to.deep.equal({ masked: "op•••@ex•••.com" });
      expect(options.sms).to.deep.equal({
        masked: "+41 79 ••• •• 28",
        phoneNumber: PHONE,
      });
    });

    it("omits SMS when no phone is linked (free-text users.phone ignored)", async () => {
      await seedUser("nophone", "np@example.com", { phone: PHONE });
      const session = await badgeSession("nophone");
      const options = await handleGetKioskElevationOptions(
        kioskRequest(session.uid, session.claims, {})
      );
      expect(options.sms).to.equal(null);
      expect(options.email?.masked).to.equal("np•••@ex•••.com");
    });

    it("rejects a caller without an actsAs session", async () => {
      await expectHttpsError(
        () =>
          handleGetKioskElevationOptions(
            kioskRequest("real-uid", { email: "x@y.ch" }, {})
          ),
        "permission-denied"
      );
      await expectHttpsError(
        () =>
          handleGetKioskElevationOptions({
            data: {},
            rawRequest: { headers: {} },
          } as unknown as CallableRequest<{ bearer?: string }>),
        "unauthenticated"
      );
    });
  });

  describe("e-mail step-up", () => {
    it("sends the code to the STORED e-mail and re-mints the same session uid elevated", async () => {
      await seedUser("stepup", "stepup@example.com");
      const session = await badgeSession("stepup");

      const req = await handleRequestKioskElevation(
        kioskRequest(session.uid, session.claims, {}),
        ORIGIN
      );
      expect(req.masked).to.equal("st•••@ex•••.com");
      const code = await latestCode("stepup@example.com");

      const result = await handleVerifyKioskElevation(
        kioskRequest(session.uid, session.claims, { code })
      );
      const decoded = decodeCustomToken(result.customToken);
      expect(decoded.uid).to.equal(session.uid);
      expect(decoded.claims.actsAs).to.equal("stepup");
      expect(decoded.claims.tagCheckout).to.equal(true);
      expect(decoded.claims.method).to.equal("tag");
      expect(decoded.claims.elevatedUntil).to.be.a("number");
      expect(result.elevatedUntil).to.equal(decoded.claims.elevatedUntil);
      expect(result.userId).to.equal("stepup");
    });

    it("rejects a wrong code and consumes a used one", async () => {
      await seedUser("wrong", "wrong@example.com");
      const session = await badgeSession("wrong");
      await handleRequestKioskElevation(
        kioskRequest(session.uid, session.claims, {}),
        ORIGIN
      );
      await expectHttpsError(
        () =>
          handleVerifyKioskElevation(
            kioskRequest(session.uid, session.claims, { code: "000000" })
          ),
        "failed-precondition",
        "Code falsch."
      );
      const code = await latestCode("wrong@example.com");
      await handleVerifyKioskElevation(
        kioskRequest(session.uid, session.claims, { code })
      );
      await expectHttpsError(
        () =>
          handleVerifyKioskElevation(
            kioskRequest(session.uid, session.claims, { code })
          ),
        "failed-precondition",
        "bereits verwendet"
      );
    });

    it("rejects non-actsAs callers and a missing bearer in production mode", async () => {
      await seedUser("gate", "gate@example.com");
      await expectHttpsError(
        () =>
          handleRequestKioskElevation(
            kioskRequest("gate", { email: "gate@example.com" }, {}),
            ORIGIN
          ),
        "permission-denied"
      );
      const session = await badgeSession("gate");
      process.env.KIOSK_BEARER_KEY = "test-kiosk-bearer";
      process.env.FUNCTIONS_EMULATOR = "";
      try {
        await expectHttpsError(
          () =>
            handleRequestKioskElevation(
              kioskRequest(session.uid, session.claims, {}),
              ORIGIN
            ),
          "permission-denied"
        );
      } finally {
        process.env.FUNCTIONS_EMULATOR = "true";
        delete process.env.KIOSK_BEARER_KEY;
      }
    });
  });

  describe("authorization on the claim", () => {
    it("requireElevatedActsAs accepts a live claim and rejects expired/absent", () => {
      const live = kioskRequest(
        "tag:u:1",
        { tagCheckout: true, actsAs: "u", elevatedUntil: Date.now() + 60_000 },
        {}
      );
      expect(requireElevatedActsAs(live)).to.equal("u");
      expect(() =>
        requireElevatedActsAs(
          kioskRequest(
            "tag:u:1",
            { tagCheckout: true, actsAs: "u", elevatedUntil: Date.now() - 1 },
            {}
          )
        )
      ).to.throw(/erneut/);
      expect(() =>
        requireElevatedActsAs(
          kioskRequest("tag:u:1", { tagCheckout: true, actsAs: "u" }, {})
        )
      ).to.throw(/erneut/);
    });

    it("callerUserRef resolves an elevated actsAs to the acted-on user and rejects otherwise", async () => {
      const db = getFirestore();
      const elevated = callerUserRef(db, "tag:u:1", {
        actsAs: "u",
        elevatedUntil: Date.now() + 60_000,
      });
      expect(elevated.path).to.equal("users/u");
      expect(() =>
        callerUserRef(db, "tag:u:1", { actsAs: "u", elevatedUntil: Date.now() - 1 })
      ).to.throw(/Code/);
      expect(() => callerUserRef(db, "tag:u:1", { actsAs: "u" })).to.throw(
        /Code/
      );
      expect(callerUserRef(db, "real", { email: "r@x.ch" }).path).to.equal(
        "users/real"
      );
    });

    it("callerEmail falls back to the user doc for a kiosk session", async () => {
      const db = getFirestore();
      await seedUser("mailfrom", "MailFrom@Example.com");
      const ref = db.collection("users").doc("mailfrom");
      expect(await callerEmail(ref, { actsAs: "mailfrom" })).to.equal(
        "mailfrom@example.com"
      );
      expect(await callerEmail(ref, { email: "Token@Example.com" })).to.equal(
        "token@example.com"
      );
      expect(await callerEmail(ref, {})).to.equal(null);
    });

    it("purchaseMembership works for an elevated kiosk session, not for a plain one", async () => {
      const db = getFirestore();
      const membership: CatalogEntity = {
        code: "MEMBERSHIP",
        name: "Mitgliedschaft",
        workshops: ["diverses"],
        category: ["Mitgliedschaft"],
        active: true,
        userCanAdd: false,
        description: "Jahresmitgliedschaft.",
        variants: [
          {
            id: "single",
            label: "Einzel (Jahr)",
            pricingModel: "direct",
            unitPrice: { default: 50 },
          },
        ],
      };
      await db.collection("catalog").doc("membership-sku").set(membership);
      await db
        .doc("config/catalog-references")
        .set({ membership: db.collection("catalog").doc("membership-sku") });
      await seedUser("buyer", "buyer@example.com");

      await expectHttpsError(
        () =>
          handlePurchaseMembership(
            { type: "single" },
            { authUid: "tag:buyer:1", authToken: { actsAs: "buyer", tagCheckout: true } }
          ),
        "permission-denied"
      );

      const result = await handlePurchaseMembership(
        { type: "single" },
        {
          authUid: "tag:buyer:1",
          authToken: {
            actsAs: "buyer",
            tagCheckout: true,
            elevatedUntil: Date.now() + 60_000,
          },
        }
      );
      expect(result.unitPrice).to.equal(50);
      const checkout = await db.collection("checkouts").doc(result.checkoutId).get();
      expect(checkout.get("userId").path).to.equal("users/buyer");
    });
  });
});
