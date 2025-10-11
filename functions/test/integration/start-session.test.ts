import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
} from "../emulator-helper";
import { handleStartSession } from "../../src/session/handle_start_session";
import {
  StartSessionRequestT,
  StartSessionResult,
  TagUidT,
  TokenSessionT,
} from "../../src/fbs";

describe("handleStartSession (Integration)", () => {
  const TEST_TOKEN_ID = "04c339aa1e1890";
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

  const createRequest = (tokenIdHex: string): StartSessionRequestT => {
    const tagUid = new TagUidT();
    tagUid.uid = Array.from(Buffer.from(tokenIdHex, "hex"));

    const request = new StartSessionRequestT();
    request.tokenId = tagUid;
    return request;
  };

  const mockOptions = {
    masterKey: "test-master-key",
    systemName: "test-system",
  };

  describe("Token validation", () => {
    it("should reject unregistered token", async () => {
      const request = createRequest(TEST_TOKEN_ID);

      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.Rejected);
      expect(response.result).to.have.property(
        "message",
        "Token not registered"
      );
    });

    it("should reject deactivated token", async () => {
      await seedTestData({
        tokens: {
          [TEST_TOKEN_ID]: {
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

      const request = createRequest(TEST_TOKEN_ID);
      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.Rejected);
      expect(response.result).to.have.property("message", "Token deactivated");
    });

    it("should return AuthRequired for valid token with no active session", async () => {
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

      const request = createRequest(TEST_TOKEN_ID);
      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.AuthRequired);
    });
  });

  describe("Existing session handling", () => {
    it("should return existing active session when not expired", async () => {
      const sessionId = "testSession123";
      const startTime = Timestamp.now();

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
          [sessionId]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: startTime,
            closed: null,
            usage: [],
          },
        },
      });

      const request = createRequest(TEST_TOKEN_ID);
      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.TokenSession);
      expect(response.result).to.have.property("sessionId", sessionId);
      expect(response.result).to.have.property("userId", TEST_USER_ID);
      expect(response.result).to.have.property("userLabel", "Test User");
      expect(response.result).to.have.property("permissions");
      const tokenSession = response.result as TokenSessionT;
      expect(tokenSession.permissions).to.deep.equal(["laser"]);
    });

    it("should return AuthRequired when session is expired", async () => {
      const sessionId = "expiredSession123";
      // Create a session that started 25 hours ago (expired)
      const expiredStartTime = Timestamp.fromMillis(
        Date.now() - 25 * 60 * 60 * 1000
      );

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
          [sessionId]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: expiredStartTime,
            closed: null,
            usage: [],
          },
        },
      });

      const request = createRequest(TEST_TOKEN_ID);
      const response = await handleStartSession(request, mockOptions);

      // Should return AuthRequired for expired session
      expect(response.resultType).to.equal(StartSessionResult.AuthRequired);
    });

    it("should ignore closed sessions", async () => {
      const closedSessionId = "closedSession123";

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
          [closedSessionId]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            closed: {
              time: Timestamp.now(),
              metadata: "{}",
            },
            usage: [],
          },
        },
      });

      const request = createRequest(TEST_TOKEN_ID);
      const response = await handleStartSession(request, mockOptions);

      // Should return AuthRequired since the only session is closed
      expect(response.resultType).to.equal(StartSessionResult.AuthRequired);
    });
  });

  describe("User data retrieval", () => {
    it("should include user permissions in TokenSession response", async () => {
      const sessionId = "testSession456";

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
            permissions: ["laser", "cnc", "3dprinter"],
            roles: ["member"],
          },
        },
        sessions: {
          [sessionId]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            closed: null,
            usage: [],
          },
        },
      });

      const request = createRequest(TEST_TOKEN_ID);
      const response = await handleStartSession(request, mockOptions);

      expect(response.resultType).to.equal(StartSessionResult.TokenSession);
      const tokenSession = response.result as TokenSessionT;
      expect(tokenSession.permissions).to.deep.equal([
        "laser",
        "cnc",
        "3dprinter",
      ]);
    });
  });
});
