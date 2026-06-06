import { expect } from "chai";
import type { CallableRequest } from "firebase-functions/v2/https";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { generateValidPICCAndCMAC } from "../test-sdm-helper";

// Test keys (32-char hex = 16 bytes for AES-128). firebase-functions reads
// secret/param values from process.env at `.value()` time when not deployed,
// so prime them BEFORE importing the handler module.
const TEST_TERMINAL_KEY = "00112233445566778899aabbccddeeff";
const TEST_MASTER_KEY = "fedcba9876543210fedcba9876543210";
const TEST_SYSTEM_NAME = "test-system";
process.env.TERMINAL_KEY = TEST_TERMINAL_KEY;
process.env.DIVERSIFICATION_MASTER_KEY = TEST_MASTER_KEY;
process.env.DIVERSIFICATION_SYSTEM_NAME = TEST_SYSTEM_NAME;

import { resolveTagHandler } from "../../src/auth/resolve-tag";

describe("resolveTagHandler (Integration)", () => {
  const TEST_TOKEN_UID = "04c339aa1e1890"; // 7-byte UID
  const TEST_USER_ID = "testUser123";

  before(async function () {
    this.timeout(10000);
    await setupEmulator();
  });

  after(async () => {
    await teardownEmulator();
  });

  beforeEach(async () => {
    await clearFirestore();
  });

  function generateTestData(uid: string, counter = 0) {
    return generateValidPICCAndCMAC(
      uid,
      counter,
      TEST_TERMINAL_KEY,
      TEST_MASTER_KEY,
      TEST_SYSTEM_NAME
    );
  }

  function buildRequest(
    uid: string | null,
    data: Record<string, unknown>,
    opts: { admin?: boolean } = {}
  ): CallableRequest<unknown> {
    const auth =
      uid != null
        ? { uid, token: { ...(opts.admin ? { admin: true } : {}) } }
        : undefined;
    return {
      data,
      auth,
      rawRequest: {},
      acceptsStreaming: false,
    } as unknown as CallableRequest<unknown>;
  }

  it("returns registered:true + user for a linked tag", async () => {
    await seedTestData({
      tokens: {
        [TEST_TOKEN_UID]: { userId: `/users/${TEST_USER_ID}`, label: "Schlüssel" },
      },
      users: {
        [TEST_USER_ID]: { firstName: "Test", lastName: "User" },
      },
    });

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID);
    const res = await resolveTagHandler(
      buildRequest("admin1", { picc, cmac }, { admin: true })
    );

    expect(res.tokenId).to.equal(TEST_TOKEN_UID);
    expect(res.registered).to.equal(true);
    expect(res.deactivated).to.equal(false);
    expect(res.userId).to.equal(TEST_USER_ID);
    expect(res.userName).to.equal("Test User");
  });

  it("returns registered:false for a genuine but unregistered tag", async () => {
    const { picc, cmac } = generateTestData(TEST_TOKEN_UID);
    const res = await resolveTagHandler(
      buildRequest("admin1", { picc, cmac }, { admin: true })
    );

    expect(res.tokenId).to.equal(TEST_TOKEN_UID);
    expect(res.registered).to.equal(false);
    expect(res.deactivated).to.equal(false);
    expect(res.userId).to.equal(undefined);
  });

  it("reports a deactivated tag", async () => {
    await seedTestData({
      tokens: {
        [TEST_TOKEN_UID]: {
          userId: `/users/${TEST_USER_ID}`,
          deactivated: new Date(),
        },
      },
      users: { [TEST_USER_ID]: { firstName: "Test", lastName: "User" } },
    });

    const { picc, cmac } = generateTestData(TEST_TOKEN_UID);
    const res = await resolveTagHandler(
      buildRequest("admin1", { picc, cmac }, { admin: true })
    );

    expect(res.registered).to.equal(true);
    expect(res.deactivated).to.equal(true);
  });

  it("does NOT advance the SDM replay counter (it's a read)", async () => {
    await seedTestData({
      tokens: {
        [TEST_TOKEN_UID]: {
          userId: `/users/${TEST_USER_ID}`,
          lastSdmCounter: 5,
        },
      },
      users: { [TEST_USER_ID]: { firstName: "Test", lastName: "User" } },
    });

    // A higher counter than stored — verifyTagCheckout would advance it to 9;
    // resolveTag must leave it untouched.
    const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 9);
    await resolveTagHandler(
      buildRequest("admin1", { picc, cmac }, { admin: true })
    );

    const snap = await getFirestore()
      .collection("tokens")
      .doc(TEST_TOKEN_UID)
      .get();
    expect(snap.data()?.lastSdmCounter).to.equal(5);
  });

  it("rejects a non-admin caller", async () => {
    const { picc, cmac } = generateTestData(TEST_TOKEN_UID);
    try {
      await resolveTagHandler(buildRequest("user1", { picc, cmac }));
      expect.fail("Should have thrown permission-denied");
    } catch (error: any) {
      expect(error.code).to.equal("permission-denied");
    }
  });

  it("rejects an unauthenticated caller", async () => {
    const { picc, cmac } = generateTestData(TEST_TOKEN_UID);
    try {
      await resolveTagHandler(buildRequest(null, { picc, cmac }));
      expect.fail("Should have thrown permission-denied");
    } catch (error: any) {
      expect(error.code).to.equal("permission-denied");
    }
  });

  it("rejects a tag with an invalid CMAC", async () => {
    const { picc } = generateTestData(TEST_TOKEN_UID);
    try {
      await resolveTagHandler(
        buildRequest(
          "admin1",
          { picc, cmac: "0000000000000000" },
          { admin: true }
        )
      );
      expect.fail("Should have thrown invalid-argument");
    } catch (error: any) {
      expect(error.code).to.equal("invalid-argument");
    }
  });

  it("rejects missing picc/cmac", async () => {
    try {
      await resolveTagHandler(buildRequest("admin1", {}, { admin: true }));
      expect.fail("Should have thrown invalid-argument");
    } catch (error: any) {
      expect(error.code).to.equal("invalid-argument");
    }
  });
});
