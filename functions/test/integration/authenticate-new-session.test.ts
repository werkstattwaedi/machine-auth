import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { handleAuthenticateNewSession } from "../../src/session/handle_authenticate_new_session";
import {
  AuthenticateNewSessionRequest,
} from "../../src/proto/firebase_rpc/session.js";

describe("handleAuthenticateNewSession (Integration)", () => {
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

  const createRequest = (
    tokenIdHex: string,
    ntagChallenge: Buffer
  ): AuthenticateNewSessionRequest => {
    return {
      tokenId: { uid: new Uint8Array(Buffer.from(tokenIdHex, "hex")) },
      ntagChallenge: new Uint8Array(ntagChallenge),
    };
  };

  const mockOptions = {
    masterKey: MASTER_KEY,
    systemName: SYSTEM_NAME,
  };

  describe("Token validation", () => {
    it("should throw error for unregistered token", async () => {
      const ntagChallenge = Buffer.alloc(16);
      const request = createRequest(TEST_TOKEN_ID, ntagChallenge);

      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("not registered");
      }
    });

    it("should throw error for deactivated token", async () => {
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

      const ntagChallenge = Buffer.alloc(16);
      const request = createRequest(TEST_TOKEN_ID, ntagChallenge);

      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("deactivated");
      }
    });

    it("should throw error for missing ntagChallenge", async () => {
      const request: AuthenticateNewSessionRequest = {
        tokenId: { uid: new Uint8Array(Buffer.from(TEST_TOKEN_ID, "hex")) },
        ntagChallenge: new Uint8Array(0),
      };

      try {
        await handleAuthenticateNewSession(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("ntagChallenge");
      }
    });
  });

  describe("Session creation", () => {
    it("should create new session for valid token", async () => {
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
      });

      const ntagChallenge = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
      const request = createRequest(TEST_TOKEN_ID, ntagChallenge);

      const response = await handleAuthenticateNewSession(request, mockOptions);

      expect(response.sessionId).to.be.a("string");
      expect(response.sessionId).to.not.be.null;
      expect(response.sessionId).to.have.length.greaterThan(0);
      expect(response.cloudChallenge).to.be.instanceOf(Uint8Array);
      expect(response.cloudChallenge.length).to.be.greaterThan(0); // Encrypted challenge from authorizeStep1

      // Verify session was created in Firestore
      const db = getFirestore();
      const sessionId = response.sessionId;
      const sessionDoc = await db.collection("sessions").doc(sessionId).get();

      expect(sessionDoc.exists).to.be.true;
      const sessionData = sessionDoc.data();
      // Verify DocumentReferences
      expect(sessionData?.userId.path).to.equal(`users/${TEST_USER_ID}`);
      expect(sessionData?.tokenId.path).to.equal(`tokens/${TEST_TOKEN_ID}`);
      expect(sessionData?.rndA).to.exist; // Stored as Uint8Array
      expect(sessionData?.usage).to.deep.equal([]);
      expect(sessionData?.closed).to.be.undefined;
    });

    it("should create session with correct tokenId reference format", async () => {
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
      });

      const ntagChallenge = Buffer.from("fedcba9876543210fedcba9876543210", "hex");
      const request = createRequest(TEST_TOKEN_ID, ntagChallenge);

      const response = await handleAuthenticateNewSession(request, mockOptions);

      const db = getFirestore();
      const sessionId = response.sessionId;
      const sessionDoc = await db.collection("sessions").doc(sessionId).get();
      const sessionData = sessionDoc.data();

      // Verify it's a DocumentReference to tokens collection
      expect(sessionData?.tokenId.path).to.equal(`tokens/${TEST_TOKEN_ID}`);
      expect(sessionData?.tokenId.path).to.not.include("/users/");
    });
  });
});
