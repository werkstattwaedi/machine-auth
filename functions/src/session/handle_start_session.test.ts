import { expect } from "chai";
import * as sinon from "sinon";
import { setupFirebaseAdminMock, createFirebaseMocks } from "../testing/firebase-admin-mock";

// Setup Firebase admin mocking
const restoreRequire = setupFirebaseAdminMock();

import { Timestamp } from "firebase-admin/firestore";
import { handleStartSession } from "./handle_start_session";
import {
  StartSessionRequestT,
  StartSessionResult,
  TagUidT,
} from "../fbs";
import * as sessionExpiration from "../util/session_expiration";

describe("handleStartSession", () => {
  let mocks: any;
  let isSessionExpiredStub: sinon.SinonStub;
  let calculateSessionExpirationStub: sinon.SinonStub;

  beforeEach(() => {
    // Setup Firebase mocks using the utility
    mocks = createFirebaseMocks();
    
    // Stub session expiration functions
    isSessionExpiredStub = sinon.stub(sessionExpiration, "isSessionExpired");
    calculateSessionExpirationStub = sinon.stub(sessionExpiration, "calculateSessionExpiration");
  });

  afterEach(() => {
    sinon.restore();
  });

  const createMockRequest = (tokenUid: Buffer): StartSessionRequestT => {
    const tagUid = new TagUidT();
    tagUid.uid = Array.from(tokenUid);
    
    const request = new StartSessionRequestT();
    request.tokenId = tagUid;
    return request;
  };

  const mockOptions = {
    masterKey: "test-master-key",
    systemName: "test-system",
  };

  describe("token validation", () => {
    it("should reject request with missing token uid", async () => {
      const request = new StartSessionRequestT();
      // tokenId is undefined
      
      try {
        await handleStartSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Missing token uid in startSession request");
      }
    });

    it("should reject request with empty token uid", async () => {
      const request = new StartSessionRequestT();
      request.tokenId = new TagUidT();
      // uid is undefined
      
      try {
        await handleStartSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Missing token uid in startSession request");
      }
    });
  });

  describe("token lookup", () => {
    it("should reject unregistered token", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const request = createMockRequest(tokenUid);

      // Mock empty query result (token not found)
      const mockQuery = {
        empty: true,
        docs: [],
      };

      // Configure mock to return empty query (no tokens found)
      mocks.mockQuery.empty = true;
      mocks.mockQuery.docs = [];
      mocks.mockCollectionGroup.where.returnsThis();
      mocks.mockCollectionGroup.limit.returnsThis();
      mocks.mockCollectionGroup.get.resolves(mocks.mockQuery);

      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.Rejected);
      expect(response.result).to.have.property("message", "Token not registered");
    });

    it("should reject deactivated token", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const request = createMockRequest(tokenUid);

      // Mock token found but deactivated
      const mockTokenDoc = {
        id: "token123",
        data: () => ({ deactivated: true }),
        ref: { parent: { parent: { id: "user123" } } },
      };

      // Configure mock to return deactivated token
      mocks.mockQuery.empty = false;
      mocks.mockQuery.docs = [mockTokenDoc];
      mocks.mockCollectionGroup.where.returnsThis();
      mocks.mockCollectionGroup.limit.returnsThis();
      mocks.mockCollectionGroup.get.resolves(mocks.mockQuery);

      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.Rejected);
      expect(response.result).to.have.property("message", "Token has been deactivated");
    });
  });

  describe("existing session handling", () => {
    const setupValidToken = () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const request = createMockRequest(tokenUid);

      const mockTokenDoc = {
        id: "token123",
        data: () => ({ deactivated: false }),
        ref: { parent: { parent: { id: "user123" } } },
      };

      const mockTokenQuery = {
        empty: false,
        docs: [mockTokenDoc],
      };

      const mockCollectionGroup = {
        where: sinon.stub().returnsThis(),
        limit: sinon.stub().returnsThis(),
        get: sinon.stub().resolves(mockTokenQuery),
      };

      return { request, mockCollectionGroup, tokenUid };
    };

    it("should return existing active session when not expired", async () => {
      const { request, mockCollectionGroup } = setupValidToken();

      const mockSessionDoc = {
        id: "session123",
        exists: true,
        data: () => ({
          user: "user123",
          token: "token123",
          startTime: Timestamp.now(),
          closed: false,
        }),
      };

      const mockSessionQuery = {
        empty: false,
        docs: [mockSessionDoc],
      };

      const mockCollection = {
        where: sinon.stub().returnsThis(),
        orderBy: sinon.stub().returnsThis(),
        limit: sinon.stub().returnsThis(),
        get: sinon.stub().resolves(mockSessionQuery),
      };

      // Configure mocks for existing active session
      mocks.mockQuery.empty = false;
      mocks.mockQuery.docs = [mockSessionDoc];
      mocks.mockCollectionGroup.where.returnsThis();
      mocks.mockCollectionGroup.limit.returnsThis();
      mocks.mockCollectionGroup.get.resolves(mocks.mockQuery);
      
      mocks.mockCollection.where.returnsThis();
      mocks.mockCollection.orderBy.returnsThis();
      mocks.mockCollection.limit.returnsThis();
      mocks.mockCollection.get.resolves(mockSessionQuery);

      // Mock session not expired
      isSessionExpiredStub.returns(false);

      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.TokenSession);
      expect(response.result).to.have.property("sessionId", "session123");
    });

    it("should close expired session and create new one", async () => {
      const { request, mockCollectionGroup } = setupValidToken();

      const mockExpiredSessionDoc = {
        id: "expired-session",
        exists: true,
        data: () => ({
          user: "user123",
          token: "token123",
          startTime: Timestamp.fromDate(new Date(Date.now() - 86400000)), // 1 day ago
          closed: false,
        }),
        ref: {
          update: sinon.stub().resolves(),
        },
      };

      const mockSessionQuery = {
        empty: false,
        docs: [mockExpiredSessionDoc],
      };

      const mockNewSessionDoc = {
        id: "new-session-123",
      };

      const mockCollection = {
        where: sinon.stub().returnsThis(),
        orderBy: sinon.stub().returnsThis(),
        limit: sinon.stub().returnsThis(),
        get: sinon.stub().resolves(mockSessionQuery),
        add: sinon.stub().resolves(mockNewSessionDoc),
      };

      // Configure mocks for expired session that needs replacement
      mocks.mockQuery.empty = false;
      mocks.mockQuery.docs = [mockExpiredSessionDoc];
      mocks.mockCollectionGroup.where.returnsThis();
      mocks.mockCollectionGroup.limit.returnsThis();
      mocks.mockCollectionGroup.get.resolves(mocks.mockQuery);
      
      mocks.mockCollection.where.returnsThis();
      mocks.mockCollection.orderBy.returnsThis();
      mocks.mockCollection.limit.returnsThis();
      mocks.mockCollection.get.resolves(mockSessionQuery);
      mocks.mockCollection.add.resolves(mockNewSessionDoc);

      // Mock session expired
      isSessionExpiredStub.returns(true);
      calculateSessionExpirationStub.returns(Timestamp.fromDate(new Date(Date.now() + 86400000)));

      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.TokenSession);
      expect(response.result).to.have.property("sessionId", "new-session-123");
      
      // Verify expired session was closed
      expect(mockExpiredSessionDoc.ref.update.calledWith({
        closed: true,
        endTime: sinon.match.instanceOf(Timestamp),
      })).to.be.true;
    });

    it("should create new session when no existing session found", async () => {
      const { request, mockCollectionGroup } = setupValidToken();

      const mockEmptySessionQuery = {
        empty: true,
        docs: [],
      };

      const mockNewSessionDoc = {
        id: "new-session-456",
      };

      const mockCollection = {
        where: sinon.stub().returnsThis(),
        orderBy: sinon.stub().returnsThis(),
        limit: sinon.stub().returnsThis(),
        get: sinon.stub().resolves(mockEmptySessionQuery),
        add: sinon.stub().resolves(mockNewSessionDoc),
      };

      // Configure mocks for new session creation (no existing sessions)
      mocks.mockQuery.empty = false;
      mocks.mockQuery.docs = [{ id: "token123", data: () => ({ deactivated: false }), ref: { parent: { parent: { id: "user123" } } } }];
      mocks.mockCollectionGroup.where.returnsThis();
      mocks.mockCollectionGroup.limit.returnsThis();
      mocks.mockCollectionGroup.get.resolves(mocks.mockQuery);
      
      mocks.mockCollection.where.returnsThis();
      mocks.mockCollection.orderBy.returnsThis();
      mocks.mockCollection.limit.returnsThis();
      mocks.mockCollection.get.resolves(mockEmptySessionQuery);
      mocks.mockCollection.add.resolves(mockNewSessionDoc);

      calculateSessionExpirationStub.returns(Timestamp.fromDate(new Date(Date.now() + 86400000)));

      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.TokenSession);
      expect(response.result).to.have.property("sessionId", "new-session-456");
    });
  });

  describe("error handling", () => {
    it("should handle Firestore errors gracefully", async () => {
      const tokenUid = Buffer.from("1234567890abcdef", "hex");
      const request = createMockRequest(tokenUid);

      // Configure mock to simulate Firestore error
      mocks.mockCollectionGroup.where.returnsThis();
      mocks.mockCollectionGroup.limit.returnsThis();
      mocks.mockCollectionGroup.get.rejects(new Error("Firestore connection error"));

      try {
        await handleStartSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Firestore connection error");
      }
    });
  });

  describe("session expiration logic", () => {
    it("should call session expiration functions with correct parameters", async () => {
      const { request, mockCollectionGroup } = setupValidToken();

      const startTime = Timestamp.fromDate(new Date());
      const mockSessionDoc = {
        id: "session123",
        exists: true,
        data: () => ({
          user: "user123",
          token: "token123",
          startTime,
          closed: false,
        }),
      };

      const mockSessionQuery = {
        empty: false,
        docs: [mockSessionDoc],
      };

      const mockCollection = {
        where: sinon.stub().returnsThis(),
        orderBy: sinon.stub().returnsThis(),
        limit: sinon.stub().returnsThis(),
        get: sinon.stub().resolves(mockSessionQuery),
      };

      // Configure mocks for session expiration test
      mocks.mockQuery.empty = false;
      mocks.mockQuery.docs = [{ id: "token123", data: () => ({ deactivated: false }), ref: { parent: { parent: { id: "user123" } } } }];
      mocks.mockCollectionGroup.where.returnsThis();
      mocks.mockCollectionGroup.limit.returnsThis();
      mocks.mockCollectionGroup.get.resolves(mocks.mockQuery);
      
      mocks.mockCollection.where.returnsThis();
      mocks.mockCollection.orderBy.returnsThis();
      mocks.mockCollection.limit.returnsThis();
      mocks.mockCollection.get.resolves(mockSessionQuery);

      isSessionExpiredStub.returns(false);

      await handleStartSession(request, mockOptions);

      expect(isSessionExpiredStub.calledWith(startTime)).to.be.true;
    });
  });

  function setupValidToken() {
    const tokenUid = Buffer.from("1234567890abcdef", "hex");
    const request = createMockRequest(tokenUid);

    const mockTokenDoc = {
      id: "token123",
      data: () => ({ deactivated: false }),
      ref: { parent: { parent: { id: "user123" } } },
    };

    const mockTokenQuery = {
      empty: false,
      docs: [mockTokenDoc],
    };

    const mockCollectionGroup = {
      where: sinon.stub().returnsThis(),
      limit: sinon.stub().returnsThis(),
      get: sinon.stub().resolves(mockTokenQuery),
    };

    return { request, mockCollectionGroup, tokenUid };
  }
});

// Clean up require mock after all tests
after(() => {
  restoreRequire();
});