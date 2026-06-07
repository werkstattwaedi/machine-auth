// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Covers the `verifyTagCheckoutHandler` callable wrapper (not the pure
// `handleVerifyTagCheckout`, which is exercised by verify-tag-checkout.test.ts).
// The wrapper adds the kiosk-bearer gate, HttpsError mapping, and reads the
// SDM keys from defineSecret/defineString params — `.value()` reads
// process.env directly in the local test runtime, so we prime the env here.
import { expect } from "chai";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
} from "../emulator-helper";
import { verifyTagCheckoutHandler } from "../../src/checkout/verify_tag";
import { generateValidPICCAndCMAC } from "../test-sdm-helper";

describe("verifyTagCheckoutHandler (callable wrapper, Integration)", () => {
  const TEST_TOKEN_UID = "04c339aa1e1890";
  const TEST_USER_ID = "testUser123";
  const TEST_TERMINAL_KEY = "00112233445566778899aabbccddeeff";
  const TEST_MASTER_KEY = "fedcba9876543210fedcba9876543210";
  const TEST_SYSTEM_NAME = "test-system";
  const TEST_BEARER = "test-kiosk-bearer";

  const savedEnv: Record<string, string | undefined> = {};

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
    for (const k of [
      "TERMINAL_KEY",
      "DIVERSIFICATION_MASTER_KEY",
      "DIVERSIFICATION_SYSTEM_NAME",
      "KIOSK_BEARER_KEY",
      "FUNCTIONS_EMULATOR",
    ]) {
      savedEnv[k] = process.env[k];
    }
    process.env.TERMINAL_KEY = TEST_TERMINAL_KEY;
    process.env.DIVERSIFICATION_MASTER_KEY = TEST_MASTER_KEY;
    process.env.DIVERSIFICATION_SYSTEM_NAME = TEST_SYSTEM_NAME;
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
  });

  function makeRequest(data: {
    picc?: string;
    cmac?: string;
    bearer?: string;
  }): CallableRequest<{ picc: string; cmac: string; bearer?: string }> {
    return { data } as CallableRequest<{
      picc: string;
      cmac: string;
      bearer?: string;
    }>;
  }

  async function seedValidToken() {
    await seedTestData({
      tokens: {
        [TEST_TOKEN_UID]: {
          userId: `/users/${TEST_USER_ID}`,
          label: "Test Token",
        },
      },
      users: {
        [TEST_USER_ID]: {
          firstName: "Test",
          lastName: "User",
          name: "Test User Full Name",
          permissions: [],
          roles: ["member"],
        },
      },
    });
    return generateValidPICCAndCMAC(
      TEST_TOKEN_UID,
      0,
      TEST_TERMINAL_KEY,
      TEST_MASTER_KEY,
      TEST_SYSTEM_NAME
    );
  }

  it("emulator mode bypasses the bearer and returns a custom token", async () => {
    const { picc, cmac } = await seedValidToken();

    const response = await verifyTagCheckoutHandler(makeRequest({ picc, cmac }));

    expect(response).to.have.property("userId", TEST_USER_ID);
    expect(response).to.have.property("customToken").that.is.a("string");
  });

  it("maps handler failures to HttpsError(invalid-argument)", async () => {
    // No seeded token → handleVerifyTagCheckout throws "Token not found",
    // which the wrapper must re-throw as an HttpsError.
    const { picc, cmac } = generateValidPICCAndCMAC(
      TEST_TOKEN_UID,
      0,
      TEST_TERMINAL_KEY,
      TEST_MASTER_KEY,
      TEST_SYSTEM_NAME
    );

    try {
      await verifyTagCheckoutHandler(makeRequest({ picc, cmac }));
      expect.fail("expected HttpsError");
    } catch (err: any) {
      expect(err.code).to.equal("invalid-argument");
      expect(err.message).to.include("Token not found");
    }
  });

  describe("production bearer gate (FUNCTIONS_EMULATOR off)", () => {
    beforeEach(() => {
      process.env.FUNCTIONS_EMULATOR = "";
    });

    it("rejects a missing bearer with permission-denied", async () => {
      try {
        await verifyTagCheckoutHandler(makeRequest({ picc: "x", cmac: "y" }));
        expect.fail("expected HttpsError");
      } catch (err: any) {
        expect(err.code).to.equal("permission-denied");
      }
    });

    it("rejects a wrong bearer with permission-denied", async () => {
      try {
        await verifyTagCheckoutHandler(
          makeRequest({ picc: "x", cmac: "y", bearer: "nope" })
        );
        expect.fail("expected HttpsError");
      } catch (err: any) {
        expect(err.code).to.equal("permission-denied");
      }
    });

    it("accepts the correct bearer and proceeds to verification", async () => {
      const { picc, cmac } = await seedValidToken();

      const response = await verifyTagCheckoutHandler(
        makeRequest({ picc, cmac, bearer: TEST_BEARER })
      );

      expect(response).to.have.property("userId", TEST_USER_ID);
      expect(response).to.have.property("customToken").that.is.a("string");
    });
  });
});
