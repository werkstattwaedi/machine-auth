import { expect } from "chai";
import * as sinon from "sinon";
import { setupFirebaseAdminMock, createFirebaseMocks } from "../testing/firebase-admin-mock";

// Setup Firebase admin mocking
const restoreRequire = setupFirebaseAdminMock();

import { Timestamp } from "firebase-admin/firestore";
import { handleCompleteAuthentication } from "./handle_complete_authentication";
import {
  CompleteAuthenticationRequestT,
  TokenSessionT,
  TagUidT,
  CompleteAuthenticationResult,
} from "../fbs";
import * as authorize from "../ntag/authorize";
import * as keyDiversification from "../ntag/key_diversification";

describe("handleCompleteAuthentication", () => {
  let mocks: any;
  let authorizeStep2Stub: sinon.SinonStub;
  let diversifyKeyStub: sinon.SinonStub;

  beforeEach(() => {
    // Setup Firebase mocks using the utility
    mocks = createFirebaseMocks();
    
    // Setup default successful mocks for user document
    const mockUserDoc = {
      exists: true,
      data: () => ({
        name: "Test User",
        email: "test@example.com"
      })
    };
    
    // Configure Firestore collection and document mocks
    mocks.mockCollection.doc = sinon.stub().returns({
      get: sinon.stub().resolves(mocks.mockDoc),
      set: sinon.stub().resolves(),
      update: sinon.stub().resolves(),
      delete: sinon.stub().resolves()
    });
    
    // Configure collection for users
    mocks.mockFirestore.collection = sinon.stub().callsFake((collectionName: string) => {
      if (collectionName === "users") {
        return {
          doc: sinon.stub().returns({
            get: sinon.stub().resolves(mockUserDoc)
          })
        };
      }
      return mocks.mockCollection;
    });
    
    // Stub crypto functions
    authorizeStep2Stub = sinon.stub(authorize, "authorizeStep2");
    diversifyKeyStub = sinon.stub(keyDiversification, "diversifyKey");
  });

  afterEach(() => {
    // Restore all stubs
    sinon.restore();
  });

  const createMockRequest = (sessionId: string, encryptedResponse: Buffer): CompleteAuthenticationRequestT => {
    const request = new CompleteAuthenticationRequestT();
    request.sessionId = sessionId;
    request.encryptedNtagResponse = Array.from(encryptedResponse);
    return request;
  };

  const mockOptions = {
    masterKey: "test-master-key",
    systemName: "test-system",
  };

  describe("error cases", () => {
    it("should handle non-existent session", async () => {
      const request = createMockRequest("non-existent-session", Buffer.from("0102030405060708", "hex"));
      
      // Configure mock for non-existent session
      const nonExistentDoc = {
        exists: false,
        data: () => null
      };
      
      mocks.mockCollection.doc = sinon.stub().returns({
        get: sinon.stub().resolves(nonExistentDoc)
      });

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Session not found");
      }
    });

    it("should handle incomplete session data", async () => {
      const request = createMockRequest("incomplete-session", Buffer.from("0102030405060708", "hex"));
      
      // Configure mock for incomplete session (missing rndA)
      const incompleteSessionDoc = {
        exists: true,
        data: () => ({
          user: "user123",
          token: "token123",
          diversifiedKey: "abcdef1234567890",
          // rndA is missing
        })
      };
      
      mocks.mockCollection.doc = sinon.stub().returns({
        get: sinon.stub().resolves(incompleteSessionDoc)
      });

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Invalid session data");
      }
    });
  });

  describe("authentication success", () => {
    it("should complete authentication and return token session", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("valid-session", encryptedResponse);
      
      // Configure successful session data
      const validSessionDoc = {
        exists: true,
        data: () => ({
          rndA: Buffer.from("1234567890abcdef", "hex"),
          tokenId: "/users/user123/token/abcd1234",
          userId: "/users/user123"
        })
      };
      
      mocks.mockCollection.doc = sinon.stub().returns({
        get: sinon.stub().resolves(validSessionDoc)
      });

      // Configure successful authorization
      const decryptedResponse = Buffer.from("fedcba0987654321", "hex");
      authorizeStep2Stub.returns(decryptedResponse);

      // Configure successful key diversification
      const diversifiedKey = Buffer.from("abcdef1234567890", "hex");
      diversifyKeyStub.returns(diversifiedKey);

      const result = await handleCompleteAuthentication(request, mockOptions);

      expect(result).to.not.be.null;
      expect(result).to.be.instanceOf(CompleteAuthenticationResult);
      
      // Verify authorization was called correctly
      expect(authorizeStep2Stub.calledOnce).to.be.true;
      expect(diversifyKeyStub.calledOnce).to.be.true;
    });

    it("should create and store token session", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("token-session-test", encryptedResponse);
      
      // Configure successful session data
      const validSessionDoc = {
        exists: true,
        data: () => ({
          rndA: Buffer.from("1234567890abcdef", "hex"),
          tokenId: "/users/user123/token/abcd1234",
          userId: "/users/user123"
        })
      };
      
      mocks.mockCollection.doc = sinon.stub().returns({
        get: sinon.stub().resolves(validSessionDoc)
      });

      // Configure successful authorization and key diversification
      authorizeStep2Stub.returns(Buffer.from("fedcba0987654321", "hex"));
      diversifyKeyStub.returns(Buffer.from("abcdef1234567890", "hex"));

      const result = await handleCompleteAuthentication(request, mockOptions);

      // Verify Firestore operations were called
      expect(mocks.mockCollection.add.calledOnce).to.be.true;
      
      // Verify the token session data structure
      const addCall = mocks.mockCollection.add.firstCall.args[0];
      expect(addCall).to.have.property('tokenId');
      expect(addCall).to.have.property('userId');
      expect(addCall).to.have.property('active', true);
    });
  });

  describe("error handling", () => {
    it("should handle invalid authentication", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("invalid-auth-session", encryptedResponse);
      
      // Configure session data
      mocks.mockDoc.exists = true;
      mocks.mockDoc.data = () => ({
        rndA: Buffer.from("1234567890abcdef", "hex"),
        tokenId: "/users/user123/token/abcd1234",
        userId: "/users/user123"
      });

      // Configure authorization to fail
      authorizeStep2Stub.throws(new Error("Authorization failed"));

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Authentication failed");
      }
    });

    it("should handle crypto errors", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("crypto-test-session", encryptedResponse);
      
      // Configure session data
      mocks.mockDoc.exists = true;
      mocks.mockDoc.data = () => ({
        rndA: Buffer.from("1234567890abcdef", "hex"),
        tokenId: "/users/user123/token/abcd1234",
        userId: "/users/user123"
      });

      // Configure authorization to succeed but key diversification to fail
      authorizeStep2Stub.returns(Buffer.from("fedcba0987654321", "hex"));
      diversifyKeyStub.throws(new Error("Crypto error"));

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Authentication failed");
      }
    });

    it("should handle Firestore errors", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("firestore-error-session", encryptedResponse);
      
      // Configure session data
      mocks.mockDoc.exists = true;
      mocks.mockDoc.data = () => ({
        rndA: Buffer.from("1234567890abcdef", "hex"),
        tokenId: "/users/user123/token/abcd1234",
        userId: "/users/user123"
      });

      // Configure successful crypto operations
      authorizeStep2Stub.returns(Buffer.from("fedcba0987654321", "hex"));
      diversifyKeyStub.returns(Buffer.from("abcdef1234567890", "hex"));
      
      // Configure Firestore to fail
      mocks.mockCollection.add.rejects(new Error("Firestore error"));

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Authentication failed");
      }
    });

    it("should handle session update errors", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("update-error-session", encryptedResponse);
      
      // Configure session data
      mocks.mockDoc.exists = true;
      mocks.mockDoc.data = () => ({
        rndA: Buffer.from("1234567890abcdef", "hex"),
        tokenId: "/users/user123/token/abcd1234",
        userId: "/users/user123"
      });

      // Configure successful crypto operations
      authorizeStep2Stub.returns(Buffer.from("fedcba0987654321", "hex"));
      diversifyKeyStub.returns(Buffer.from("abcdef1234567890", "hex"));
      
      // Configure session update to fail
      mocks.mockCollection.doc().update.rejects(new Error("Update failed"));

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Authentication failed");
      }
    });

    it("should handle crypto verification errors", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("crypto-error-session", encryptedResponse);
      
      // Configure session data
      mocks.mockDoc.exists = true;
      mocks.mockDoc.data = () => ({
        rndA: Buffer.from("1234567890abcdef", "hex"),
        tokenId: "/users/user123/token/abcd1234",
        userId: "/users/user123"
      });

      // Configure authorization to return invalid data
      authorizeStep2Stub.returns(Buffer.from("invalid", "hex"));
      diversifyKeyStub.returns(Buffer.from("abcdef1234567890", "hex"));

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Authentication failed");
      }
    });

    it("should handle hex conversion errors", async () => {
      const encryptedResponse = Buffer.from("0102030405060708", "hex");
      const request = createMockRequest("hex-test-session", encryptedResponse);
      
      // Configure session data with invalid hex
      mocks.mockDoc.exists = true;
      mocks.mockDoc.data = () => ({
        rndA: "invalid-hex-data", // Not a valid Buffer
        tokenId: "/users/user123/token/abcd1234",
        userId: "/users/user123"
      });

      try {
        await handleCompleteAuthentication(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("Authentication failed");
      }
    });
  });
});