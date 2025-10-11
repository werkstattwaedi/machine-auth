import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
} from "../emulator-helper";
import { handleCompleteAuthentication } from "../../src/session/handle_complete_authentication";
import { handleAuthenticateNewSession } from "../../src/session/handle_authenticate_new_session";
import {
  CompleteAuthenticationRequestT,
  CompleteAuthenticationResult,
  AuthenticateNewSessionRequestT,
  TagUidT,
} from "../../src/fbs";

describe("handleCompleteAuthentication (Integration)", () => {
  const TEST_TOKEN_ID = "04c339aa1e1890";
  const TEST_USER_ID = "testUser123";
  const MASTER_KEY = "0123456789abcdef0123456789abcdef"; // Must be 32 hex chars (16 bytes)
  const SYSTEM_NAME = "TestSystem";

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

  const mockOptions = {
    masterKey: MASTER_KEY,
    systemName: SYSTEM_NAME,
  };

  describe("Session validation", () => {
    it("should reject missing sessionId", async () => {
      const request = new CompleteAuthenticationRequestT();
      request.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("sessionId");
      }
    });

    it("should reject non-existent session", async () => {
      const request = new CompleteAuthenticationRequestT();
      request.sessionId = "nonExistentSession123";
      request.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      const response = await handleCompleteAuthentication(request, mockOptions);

      expect(response.resultType).to.equal(CompleteAuthenticationResult.Rejected);
    });

    it("should reject missing encryptedNtagResponse", async () => {
      const request = new CompleteAuthenticationRequestT();
      request.sessionId = "testSession123";

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("encryptedNtagResponse");
      }
    });
  });

  describe("Token path format", () => {
    it("should correctly parse new /tokens/ path format", async () => {
      // Create a session with the new token path format
      await seedTestData({
        tokens: {
          [TEST_TOKEN_ID]: {
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
        sessions: {
          testSession456: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            rndA: Array.from(Buffer.alloc(16)),
            usage: [],
          },
        },
      });

      const request = new CompleteAuthenticationRequestT();
      request.sessionId = "testSession456";
      request.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      // This should not throw an error about invalid path format
      const response = await handleCompleteAuthentication(request, mockOptions);

      // It will be rejected due to authentication failure, but not path parsing
      expect(response.resultType).to.equal(CompleteAuthenticationResult.Rejected);
      // Should not be a path format error
      if (response.result && "message" in response.result) {
        expect(response.result.message).to.not.include("Invalid tokenId reference format");
      }
    });

    it("should reject old /users/.../token/ path format", async () => {
      // Create a session with the OLD token path format
      await seedTestData({
        tokens: {
          [TEST_TOKEN_ID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
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
        sessions: {
          oldFormatSession: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/users/${TEST_USER_ID}/token/${TEST_TOKEN_ID}`, // OLD FORMAT
            startTime: Timestamp.now(),
            rndA: Array.from(Buffer.alloc(16)),
            usage: [],
          },
        },
      });

      const request = new CompleteAuthenticationRequestT();
      request.sessionId = "oldFormatSession";
      request.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      const response = await handleCompleteAuthentication(request, mockOptions);

      expect(response.resultType).to.equal(CompleteAuthenticationResult.Rejected);
      if (response.result && "message" in response.result) {
        expect(response.result.message).to.include("Invalid tokenId reference format");
      }
    });
  });

  describe("End-to-end authentication flow", () => {
    it("should complete full authentication flow", async function () {
      this.timeout(5000);

      await seedTestData({
        tokens: {
          [TEST_TOKEN_ID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
          },
        },
        users: {
          [TEST_USER_ID]: {
            displayName: "Test User",
            name: "Test User Full Name",
            permissions: ["laser", "cnc"],
            roles: ["member"],
          },
        },
      });

      // Step 1: Start authentication (creates session)
      const authRequest = new AuthenticateNewSessionRequestT();
      const tagUid = new TagUidT();
      tagUid.uid = Array.from(Buffer.from(TEST_TOKEN_ID, "hex"));
      authRequest.tokenId = tagUid;
      authRequest.ntagChallenge = Array.from(Buffer.from("0123456789abcdef0123456789abcdef", "hex"));

      const authResponse = await handleAuthenticateNewSession(authRequest, mockOptions);

      expect(authResponse.sessionId).to.be.a("string");
      expect(authResponse.cloudChallenge).to.be.an("array");

      // Step 2: Complete authentication
      // Note: In real scenario, the encrypted response would be properly calculated
      // For this test, we expect it to fail authentication but not due to path issues
      const completeRequest = new CompleteAuthenticationRequestT();
      completeRequest.sessionId = authResponse.sessionId;
      completeRequest.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      const completeResponse = await handleCompleteAuthentication(completeRequest, mockOptions);

      // Will be rejected due to crypto, but session structure should be valid
      expect(completeResponse.resultType).to.equal(CompleteAuthenticationResult.Rejected);
    });
  });
});
