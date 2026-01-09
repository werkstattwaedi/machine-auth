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
  StartSessionRequest,
  StartSessionResponse,
  TokenSession,
} from "../../src/proto/firebase_rpc/session.js";
import { TagUid } from "../../src/proto/common.js";

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

  const createRequest = (tokenIdHex: string): StartSessionRequest => {
    return {
      tokenId: { uid: new Uint8Array(Buffer.from(tokenIdHex, "hex")) },
    };
  };

  const mockOptions = {
    masterKey: "test-master-key",
    systemName: "test-system",
  };

  describe("Token validation", () => {
    it("should reject unregistered token", async () => {
      const request = createRequest(TEST_TOKEN_ID);

      const response = await handleStartSession(request, mockOptions);

      expect(response.result?.$case).to.equal("rejected");
      if (response.result?.$case === "rejected") {
        expect(response.result.rejected.message).to.equal("Token not registered");
      }
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

      expect(response.result?.$case).to.equal("rejected");
      if (response.result?.$case === "rejected") {
        expect(response.result.rejected.message).to.equal("Token deactivated");
      }
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

      expect(response.result?.$case).to.equal("authRequired");
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

      expect(response.result?.$case).to.equal("session");
      if (response.result?.$case === "session") {
        const tokenSession = response.result.session;
        expect(tokenSession.sessionId).to.equal(sessionId);
        expect(tokenSession.userId).to.equal(TEST_USER_ID);
        expect(tokenSession.userLabel).to.equal("Test User");
        expect(tokenSession.permissions).to.deep.equal(["laser"]);
      }
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
      expect(response.result?.$case).to.equal("authRequired");
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
      expect(response.result?.$case).to.equal("authRequired");
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

      expect(response.result?.$case).to.equal("session");
      if (response.result?.$case === "session") {
        const tokenSession = response.result.session;
        expect(tokenSession.permissions).to.deep.equal([
          "laser",
          "cnc",
          "3dprinter",
        ]);
      }
    });
  });
});
