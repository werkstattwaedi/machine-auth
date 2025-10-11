import { expect } from "chai";
import * as admin from "firebase-admin";
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

  describe("DocumentReference validation", () => {
    it("should reject sessions with string-based references", async () => {
      const db = admin.firestore();

      // Manually create documents with string references (bypassing seedTestData conversion)
      await db.collection("tokens").doc(TEST_TOKEN_ID).set({
        userId: `/users/${TEST_USER_ID}`, // String reference instead of DocumentReference
        label: "Test Token",
        registered: Timestamp.now(),
      });

      await db.collection("users").doc(TEST_USER_ID).set({
        displayName: "Test User",
        name: "Test User Full Name",
        permissions: [],
        roles: [],
        created: Timestamp.now(),
      });

      await db.collection("sessions").doc("stringRefSession").set({
        userId: `/users/${TEST_USER_ID}`, // String reference instead of DocumentReference
        tokenId: `/tokens/${TEST_TOKEN_ID}`, // String reference instead of DocumentReference
        startTime: Timestamp.now(),
        rndA: Array.from(Buffer.alloc(16)),
        usage: [],
      });

      const request = new CompleteAuthenticationRequestT();
      request.sessionId = "stringRefSession";
      request.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      const response = await handleCompleteAuthentication(request, mockOptions);

      // Should be rejected due to invalid reference format
      expect(response.resultType).to.equal(CompleteAuthenticationResult.Rejected);
      if (response.result && "message" in response.result) {
        expect(response.result.message).to.include("expected DocumentReference");
      }
    });
  });

  describe("Permissions handling", () => {
    it("should correctly serialize permissions array to flatbuffers", async () => {
      const db = admin.firestore();

      // Create permission documents first
      await seedTestData({
        permissions: {
          permission1: { name: "Permission 1" },
          permission2: { name: "Permission 2" },
          permission3: { name: "Permission 3" },
        },
        tokens: {
          [TEST_TOKEN_ID]: {
            userId: `/users/${TEST_USER_ID}`,
            label: "Test Token",
          },
        },
      });

      // Create user with DocumentReferences to permissions
      await db.collection("users").doc(TEST_USER_ID).set({
        displayName: "Test User",
        name: "Test User Full Name",
        permissions: [
          db.doc("permission/permission1"),
          db.doc("permission/permission2"),
          db.doc("permission/permission3"),
        ],
        roles: ["member"],
        created: Timestamp.now(),
      });

      // Create session for authentication
      const authRequest = new AuthenticateNewSessionRequestT();
      const tagUid = new TagUidT();
      tagUid.uid = Array.from(Buffer.from(TEST_TOKEN_ID, "hex"));
      authRequest.tokenId = tagUid;
      authRequest.ntagChallenge = Array.from(Buffer.from("0123456789abcdef0123456789abcdef", "hex"));

      const authResponse = await handleAuthenticateNewSession(authRequest, mockOptions);

      // Try to complete authentication - it will fail crypto but we can test the response structure
      const completeRequest = new CompleteAuthenticationRequestT();
      completeRequest.sessionId = authResponse.sessionId;
      completeRequest.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      // This should not throw "obj.pack is not a function" error
      let thrownError;
      try {
        await handleCompleteAuthentication(completeRequest, mockOptions);
      } catch (error) {
        thrownError = error;
      }

      // Should not get a flatbuffer packing error
      if (thrownError) {
        expect((thrownError as Error).message).to.not.include("obj.pack is not a function");
      }
    });

    it("should handle empty permissions array", async () => {
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
            roles: ["member"],
          },
        },
      });

      const authRequest = new AuthenticateNewSessionRequestT();
      const tagUid = new TagUidT();
      tagUid.uid = Array.from(Buffer.from(TEST_TOKEN_ID, "hex"));
      authRequest.tokenId = tagUid;
      authRequest.ntagChallenge = Array.from(Buffer.from("0123456789abcdef0123456789abcdef", "hex"));

      const authResponse = await handleAuthenticateNewSession(authRequest, mockOptions);

      const completeRequest = new CompleteAuthenticationRequestT();
      completeRequest.sessionId = authResponse.sessionId;
      completeRequest.encryptedNtagResponse = Array.from(Buffer.alloc(16));

      // Should not throw
      const response = await handleCompleteAuthentication(completeRequest, mockOptions);

      // Response will be rejected due to crypto, but should not throw packing errors
      expect(response).to.not.be.undefined;
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
