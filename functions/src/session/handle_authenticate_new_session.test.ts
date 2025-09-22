import { expect } from "chai";
import * as sinon from "sinon";
import { setupFirebaseAdminMock, createFirebaseMocks } from "../testing/firebase-admin-mock";

// Setup Firebase admin mocking
const restoreRequire = setupFirebaseAdminMock();

import { Timestamp } from "firebase-admin/firestore";
import { handleAuthenticateNewSession } from "./handle_authenticate_new_session";
import {
  AuthenticateNewSessionRequestT,
  TagUidT,
} from "../fbs";
import * as keyDiversification from "../ntag/key_diversification";
import * as authorize from "../ntag/authorize";

describe("handleAuthenticateNewSession", () => {
  let mocks: any;
  let diversifyKeyStub: sinon.SinonStub;
  let authorizeStep1Stub: sinon.SinonStub;

  beforeEach(() => {
    // Setup Firebase mocks using the utility
    mocks = createFirebaseMocks();
    
    // Stub crypto functions
    diversifyKeyStub = sinon.stub(keyDiversification, "diversifyKey");
    authorizeStep1Stub = sinon.stub(authorize, "authorizeStep1");
  });

  afterEach(() => {
    // Restore all stubs
    sinon.restore();
  });

  const createMockRequest = (tokenUid: Buffer, ntagChallenge: Buffer): AuthenticateNewSessionRequestT => {
    const tagUid = new TagUidT();
    tagUid.uid = Array.from(tokenUid);
    
    const request = new AuthenticateNewSessionRequestT();
    request.tokenId = tagUid;
    request.ntagChallenge = Array.from(ntagChallenge);
    return request;
  };

  const mockOptions = {
    masterKey: "test-master-key",
    systemName: "test-system",
  };

  describe("input validation", () => {
    it("should throw error for missing token uid", async () => {
      const request = new AuthenticateNewSessionRequestT();
      // tokenId is undefined
      
      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Missing token uid in authenticate request");
      }
    });

    it("should throw error for empty token uid", async () => {
      const request = new AuthenticateNewSessionRequestT();
      request.tokenId = new TagUidT();
      request.ntagChallenge = [1, 2, 3, 4]; // Add valid challenge so it hits the uid check first
      // uid is undefined
      
      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Missing token uid in authenticate request");
      }
    });

    it("should throw error for missing ntagChallenge", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const request = new AuthenticateNewSessionRequestT();
      const tagUid = new TagUidT();
      tagUid.uid = Array.from(tokenUid);
      request.tokenId = tagUid;
      // ntagChallenge is undefined
      
      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Missing ntagChallenge in authenticate request");
      }
    });

    it("should throw error for empty ntagChallenge", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const request = new AuthenticateNewSessionRequestT();
      const tagUid = new TagUidT();
      tagUid.uid = Array.from(tokenUid);
      request.tokenId = tagUid;
      request.ntagChallenge = []; // empty array
      
      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Missing ntagChallenge in authenticate request");
      }
    });
  });

  describe("token validation", () => {
    it("should throw error for unregistered token", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const ntagChallenge = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest(tokenUid, ntagChallenge);

      // Configure mock to return empty result (token not found)
      mocks.mockQuery.empty = true;
      mocks.mockQuery.docs = [];

      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("is not registered to any user");
      }
    });

    it("should throw error for deactivated token", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const ntagChallenge = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest(tokenUid, ntagChallenge);

      // Configure mock to return deactivated token
      mocks.mockQuery.empty = false;
      mocks.mockQuery.docs = [{
        id: "token123",
        data: () => ({ deactivated: true }),
        ref: { parent: { parent: { id: "user123" } } },
      }];

      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("has been deactivated");
      }
    });
  });

  describe("successful authentication", () => {
    it("should create session with proper authentication data", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const ntagChallenge = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest(tokenUid, ntagChallenge);

      // Configure mock to return valid token
      mocks.mockQuery.empty = false;
      mocks.mockQuery.docs = [{
        id: "token123",
        data: () => ({ deactivated: false }),
        ref: { parent: { parent: { id: "user123" } } },
      }];

      // Mock crypto functions
      const mockDiversifiedKey = "abcdef1234567890abcdef1234567890"; // 32 hex chars = 16 bytes
      const mockCloudChallenge = Buffer.from("1111222233334444", "hex");
      const mockEncrypted = Buffer.from("5555666677778888", "hex");

      diversifyKeyStub.returns(mockDiversifiedKey);
      authorizeStep1Stub.returns({
        cloudChallenge: mockCloudChallenge,
        encrypted: mockEncrypted,
      });

      const response = await handleAuthenticateNewSession(request, mockOptions);

      // Verify response structure
      expect(response).to.have.property("sessionId", "mock-session-id");
      expect(response).to.have.property("cloudChallenge");
      expect(Array.from(response.cloudChallenge!)).to.deep.equal(Array.from(mockEncrypted));

      // Verify session was created with correct data
      const mockDoc = mocks.mockCollection.doc();
      expect(mockDoc.set.calledOnce).to.be.true;
      const sessionData = mockDoc.set.getCall(0).args[0];
      expect(sessionData).to.have.property("userId", "/users/user123");
      expect(sessionData).to.have.property("tokenId", "/users/user123/token/1234567890abcdef");
      expect(sessionData).to.have.property("rndA");
      expect(sessionData).to.have.property("startTime");
      expect(sessionData).to.have.property("usage");
      expect(Array.isArray(sessionData.usage)).to.be.true;
    });
  });
});

// Clean up require mock after all tests
after(() => {
  restoreRequire();
});