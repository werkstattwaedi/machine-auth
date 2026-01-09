import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  seedTestData,
  getFirestore,
} from "../emulator-helper";
import { handleUploadUsage } from "../../src/session/handle_upload_usage";
import {
  UploadUsageRequest,
  MachineUsageHistory,
  MachineUsage,
} from "../../src/proto/firebase_rpc/usage.js";

describe("handleUploadUsage (Integration)", () => {
  const TEST_SESSION_ID = "testSession123";
  const TEST_USER_ID = "testUser123";
  const TEST_TOKEN_ID = "04c339aa1e1890";

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
    masterKey: "test-master-key",
    systemName: "test-system",
  };

  describe("Request validation", () => {
    it("should throw error for missing usage history", async () => {
      const request: UploadUsageRequest = {
        history: undefined,
      };

      try {
        await handleUploadUsage(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("usage history");
      }
    });

    it("should handle empty usage records", async () => {
      const request: UploadUsageRequest = {
        history: {
          machineId: "test-machine",
          records: [],
        },
      };

      const response = await handleUploadUsage(request, mockOptions);

      expect(response.success).to.be.true;
    });
  });

  describe("Usage record processing", () => {
    it("should append usage records to existing session", async () => {
      await seedTestData({
        sessions: {
          [TEST_SESSION_ID]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            usage: [],
            closed: null,
          },
        },
      });

      const record1: MachineUsage = {
        sessionId: TEST_SESSION_ID,
        checkIn: BigInt(Date.now() - 3600000), // 1 hour ago
        checkOut: BigInt(Date.now() - 1800000), // 30 min ago
        reason: { reason: { $case: "selfCheckout", selfCheckout: {} } },
      };

      const record2: MachineUsage = {
        sessionId: TEST_SESSION_ID,
        checkIn: BigInt(Date.now() - 1800000), // 30 min ago
        checkOut: BigInt(Date.now()), // now
        reason: { reason: { $case: "selfCheckout", selfCheckout: {} } },
      };

      const request: UploadUsageRequest = {
        history: {
          machineId: "test-machine",
          records: [record1, record2],
        },
      };

      const response = await handleUploadUsage(request, mockOptions);

      expect(response.success).to.be.true;

      // Verify records were added to Firestore
      const db = getFirestore();
      const sessionDoc = await db.collection("sessions").doc(TEST_SESSION_ID).get();
      const sessionData = sessionDoc.data();

      expect(sessionData?.usage).to.be.an("array");
      expect(sessionData?.usage).to.have.length(2);

      // Verify first record
      expect(sessionData?.usage[0]).to.have.property("checkIn");
      expect(sessionData?.usage[0]).to.have.property("checkOut");
      expect(sessionData?.usage[0]).to.have.property("metadata");

      // Verify second record
      expect(sessionData?.usage[1]).to.have.property("checkIn");
      expect(sessionData?.usage[1]).to.have.property("checkOut");
      expect(sessionData?.usage[1]).to.have.property("metadata");
    });

    it("should handle multiple sessions in one upload", async () => {
      const session1Id = "session1";
      const session2Id = "session2";

      await seedTestData({
        sessions: {
          [session1Id]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            usage: [],
            closed: null,
          },
          [session2Id]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            usage: [],
            closed: null,
          },
        },
      });

      const record1: MachineUsage = {
        sessionId: session1Id,
        checkIn: BigInt(Date.now() - 3600000),
        checkOut: BigInt(Date.now() - 1800000),
        reason: { reason: { $case: "selfCheckout", selfCheckout: {} } },
      };

      const record2: MachineUsage = {
        sessionId: session2Id,
        checkIn: BigInt(Date.now() - 1800000),
        checkOut: BigInt(Date.now()),
        reason: { reason: { $case: "timeout", timeout: {} } },
      };

      const request: UploadUsageRequest = {
        history: {
          machineId: "test-machine",
          records: [record1, record2],
        },
      };

      const response = await handleUploadUsage(request, mockOptions);

      expect(response.success).to.be.true;

      // Verify both sessions were updated
      const db = getFirestore();
      const session1Doc = await db.collection("sessions").doc(session1Id).get();
      const session2Doc = await db.collection("sessions").doc(session2Id).get();

      expect(session1Doc.data()?.usage).to.have.length(1);
      expect(session2Doc.data()?.usage).to.have.length(1);
    });

    it("should skip records with missing sessionId", async () => {
      await seedTestData({
        sessions: {
          [TEST_SESSION_ID]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            usage: [],
            closed: null,
          },
        },
      });

      const validRecord: MachineUsage = {
        sessionId: TEST_SESSION_ID,
        checkIn: BigInt(Date.now() - 3600000),
        checkOut: BigInt(Date.now()),
        reason: { reason: { $case: "selfCheckout", selfCheckout: {} } },
      };

      const invalidRecord: MachineUsage = {
        sessionId: "", // missing sessionId
        checkIn: BigInt(Date.now() - 3600000),
        checkOut: BigInt(Date.now()),
        reason: { reason: { $case: "selfCheckout", selfCheckout: {} } },
      };

      const request: UploadUsageRequest = {
        history: {
          machineId: "test-machine",
          records: [validRecord, invalidRecord],
        },
      };

      const response = await handleUploadUsage(request, mockOptions);

      expect(response.success).to.be.true;

      // Verify only valid record was added
      const db = getFirestore();
      const sessionDoc = await db.collection("sessions").doc(TEST_SESSION_ID).get();
      const sessionData = sessionDoc.data();

      expect(sessionData?.usage).to.have.length(1);
    });

    it("should preserve existing usage records when appending new ones", async () => {
      const existingUsage = [
        {
          machine: "/machine/laser1",
          checkIn: Timestamp.fromMillis(Date.now() - 7200000),
          checkOut: Timestamp.fromMillis(Date.now() - 3600000),
          metadata: JSON.stringify({ reason: "selfCheckout" }),
        },
      ];

      await seedTestData({
        sessions: {
          [TEST_SESSION_ID]: {
            userId: `/users/${TEST_USER_ID}`,
            tokenId: `/tokens/${TEST_TOKEN_ID}`,
            startTime: Timestamp.now(),
            usage: existingUsage,
            closed: null,
          },
        },
      });

      const newRecord: MachineUsage = {
        sessionId: TEST_SESSION_ID,
        checkIn: BigInt(Date.now() - 1800000),
        checkOut: BigInt(Date.now()),
        reason: { reason: { $case: "selfCheckout", selfCheckout: {} } },
      };

      const request: UploadUsageRequest = {
        history: {
          machineId: "test-machine",
          records: [newRecord],
        },
      };

      const response = await handleUploadUsage(request, mockOptions);

      expect(response.success).to.be.true;

      // Verify both old and new records exist
      const db = getFirestore();
      const sessionDoc = await db.collection("sessions").doc(TEST_SESSION_ID).get();
      const sessionData = sessionDoc.data();

      expect(sessionData?.usage).to.have.length(2);
    });
  });
});
