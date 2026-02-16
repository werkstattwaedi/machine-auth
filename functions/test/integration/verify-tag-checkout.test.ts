import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
} from "../emulator-helper";
import { handleVerifyTagCheckout } from "../../src/checkout/verify_tag";
import { VerifyTagRequest } from "../../src/checkout/verify_tag";
import { generateValidPICCAndCMAC } from "../test-sdm-helper";

describe("handleVerifyTagCheckout (Integration)", () => {
  const TEST_TOKEN_UID = "04c339aa1e1890"; // 7-byte UID
  const TEST_USER_ID = "testUser123";

  // Test keys (32-char hex = 16 bytes for AES-128)
  const TEST_TERMINAL_KEY = "00112233445566778899aabbccddeeff";
  const TEST_MASTER_KEY = "fedcba9876543210fedcba9876543210";
  const TEST_SYSTEM_NAME = "test-system";

  const mockConfig = {
    terminalKey: TEST_TERMINAL_KEY,
    masterKey: TEST_MASTER_KEY,
    systemName: TEST_SYSTEM_NAME,
  };

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

  /**
   * Helper wrapper to generate test PICC and CMAC
   */
  function generateTestData(uid: string, counter: number = 0) {
    return generateValidPICCAndCMAC(
      uid,
      counter,
      TEST_TERMINAL_KEY,
      TEST_MASTER_KEY,
      TEST_SYSTEM_NAME
    );
  }

  describe("Token validation", () => {
    it("should reject request with unregistered token", async () => {
      const { picc, cmac } = generateTestData(TEST_TOKEN_UID);

      const request: VerifyTagRequest = { picc, cmac };

      try {
        await handleVerifyTagCheckout(request, mockConfig);
        expect.fail("Should have thrown error for unregistered token");
      } catch (error: any) {
        expect(error.message).to.include("Token not found");
      }
    });

    it("should reject deactivated token", async () => {
      await seedTestData({
        tokens: {
          [TEST_TOKEN_UID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
            deactivated: Timestamp.now(),
          },
        },
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            name: "Test User Full Name",
            permissions: [],
            roles: [],
          },
        },
      });

      const { picc, cmac } = generateTestData(TEST_TOKEN_UID);
      const request: VerifyTagRequest = { picc, cmac };

      try {
        await handleVerifyTagCheckout(request, mockConfig);
        expect.fail("Should have thrown error for deactivated token");
      } catch (error: any) {
        expect(error.message).to.include("Token is deactivated");
      }
    });

    it("should accept valid token and return userId", async () => {
      await seedTestData({
        tokens: {
          [TEST_TOKEN_UID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
          },
        },
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            name: "Test User Full Name",
            permissions: ["laser"],
            roles: ["member"],
          },
        },
      });

      const { picc, cmac } = generateTestData(TEST_TOKEN_UID);
      const request: VerifyTagRequest = { picc, cmac };

      const response = await handleVerifyTagCheckout(request, mockConfig);

      expect(response).to.have.property("tokenId", TEST_TOKEN_UID);
      expect(response).to.have.property("userId", TEST_USER_ID);
      expect(response).to.have.property("uid", TEST_TOKEN_UID);
    });
  });

  describe("PICC decryption", () => {
    it("should decrypt PICC data correctly", async () => {
      await seedTestData({
        tokens: {
          [TEST_TOKEN_UID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
          },
        },
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            permissions: [],
            roles: [],
          },
        },
      });

      const { picc, cmac } = generateTestData(TEST_TOKEN_UID, 42);
      const request: VerifyTagRequest = { picc, cmac };

      const response = await handleVerifyTagCheckout(request, mockConfig);

      expect(response.uid).to.equal(TEST_TOKEN_UID);
    });

    it("should reject request with invalid PICC format", async () => {
      const request: VerifyTagRequest = {
        picc: "invalid-hex",
        cmac: "0011223344556677",
      };

      try {
        await handleVerifyTagCheckout(request, mockConfig);
        expect.fail("Should have thrown error for invalid PICC format");
      } catch (error: any) {
        expect(error.message).to.exist;
      }
    });

    it("should reject request with wrong PICC length", async () => {
      const request: VerifyTagRequest = {
        picc: "00112233", // Too short
        cmac: "0011223344556677",
      };

      try {
        await handleVerifyTagCheckout(request, mockConfig);
        expect.fail("Should have thrown error for wrong PICC length");
      } catch (error: any) {
        expect(error.message).to.exist;
      }
    });
  });

  describe("CMAC verification", () => {
    it("should reject request with invalid CMAC", async () => {
      await seedTestData({
        tokens: {
          [TEST_TOKEN_UID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
          },
        },
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            permissions: [],
            roles: [],
          },
        },
      });

      const { picc } = generateTestData(TEST_TOKEN_UID);
      const request: VerifyTagRequest = {
        picc,
        cmac: "0000000000000000", // Invalid CMAC
      };

      try {
        await handleVerifyTagCheckout(request, mockConfig);
        expect.fail("Should have thrown error for invalid CMAC");
      } catch (error: any) {
        expect(error.message).to.include("CMAC");
      }
    });

    it("should reject request with wrong CMAC length", async () => {
      await seedTestData({
        tokens: {
          [TEST_TOKEN_UID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
          },
        },
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            permissions: [],
            roles: [],
          },
        },
      });

      const { picc } = generateTestData(TEST_TOKEN_UID);
      const request: VerifyTagRequest = {
        picc,
        cmac: "001122", // Too short
      };

      try {
        await handleVerifyTagCheckout(request, mockConfig);
        expect.fail("Should have thrown error for wrong CMAC length");
      } catch (error: any) {
        expect(error.message).to.exist;
      }
    });
  });

  describe("Counter handling", () => {
    it("should handle different counter values", async () => {
      await seedTestData({
        tokens: {
          [TEST_TOKEN_UID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
          },
        },
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            permissions: [],
            roles: [],
          },
        },
      });

      // Test with counter = 0
      const test1 = generateTestData(TEST_TOKEN_UID, 0);
      const response1 = await handleVerifyTagCheckout(test1, mockConfig);
      expect(response1.uid).to.equal(TEST_TOKEN_UID);

      // Test with counter = 100
      const test2 = generateTestData(TEST_TOKEN_UID, 100);
      const response2 = await handleVerifyTagCheckout(test2, mockConfig);
      expect(response2.uid).to.equal(TEST_TOKEN_UID);

      // Test with counter = 16777215 (max 24-bit value)
      const test3 = generateTestData(TEST_TOKEN_UID, 16777215);
      const response3 = await handleVerifyTagCheckout(test3, mockConfig);
      expect(response3.uid).to.equal(TEST_TOKEN_UID);
    });
  });

  describe("User lookup", () => {
    it("should return correct userId for token", async () => {
      const userId1 = "user1";
      const userId2 = "user2";
      const token1 = "04aabbcc112233";
      const token2 = "04ddeeff445566";

      await seedTestData({
        tokens: {
          [token1]: {
            userId: `/users/${userId1}`,
            label: "Token 1",
          },
          [token2]: {
            userId: `/users/${userId2}`,
            label: "Token 2",
          },
        },
        users: {
          [userId1]: {
            displayName: "User 1",
            permissions: [],
            roles: [],
          },
          [userId2]: {
            displayName: "User 2",
            permissions: [],
            roles: [],
          },
        },
      });

      // Test token 1
      const { picc: picc1, cmac: cmac1 } = generateTestData(token1);
      const response1 = await handleVerifyTagCheckout(
        { picc: picc1, cmac: cmac1 },
        mockConfig
      );
      expect(response1.userId).to.equal(userId1);
      expect(response1.tokenId).to.equal(token1);

      // Test token 2
      const { picc: picc2, cmac: cmac2 } = generateTestData(token2);
      const response2 = await handleVerifyTagCheckout(
        { picc: picc2, cmac: cmac2 },
        mockConfig
      );
      expect(response2.userId).to.equal(userId2);
      expect(response2.tokenId).to.equal(token2);
    });
  });
});
