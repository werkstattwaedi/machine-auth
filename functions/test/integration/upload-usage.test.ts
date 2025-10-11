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
  UploadUsageRequestT,
  MachineUsageHistoryT,
  MachineUsageT,
  CheckOutReason,
} from "../../src/fbs";

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
      const request = new UploadUsageRequestT();
      // history is missing

      try {
        await handleUploadUsage(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.include("usage history");
      }
    });

    it("should handle empty usage records", async () => {
      const history = new MachineUsageHistoryT();
      history.records = [];

      const request = new UploadUsageRequestT();
      request.history = history;

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

      const record1 = new MachineUsageT();
      record1.sessionId = TEST_SESSION_ID;
      record1.checkIn = BigInt(Date.now() - 3600000); // 1 hour ago
      record1.checkOut = BigInt(Date.now() - 1800000); // 30 min ago
      record1.reasonType = CheckOutReason.self_checkout;

      const record2 = new MachineUsageT();
      record2.sessionId = TEST_SESSION_ID;
      record2.checkIn = BigInt(Date.now() - 1800000); // 30 min ago
      record2.checkOut = BigInt(Date.now()); // now
      record2.reasonType = CheckOutReason.self_checkout;

      const history = new MachineUsageHistoryT();
      history.records = [record1, record2];

      const request = new UploadUsageRequestT();
      request.history = history;

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

      const record1 = new MachineUsageT();
      record1.sessionId = session1Id;
      record1.checkIn = BigInt(Date.now() - 3600000);
      record1.checkOut = BigInt(Date.now() - 1800000);
      record1.reasonType = CheckOutReason.self_checkout;

      const record2 = new MachineUsageT();
      record2.sessionId = session2Id;
      record2.checkIn = BigInt(Date.now() - 1800000);
      record2.checkOut = BigInt(Date.now());
      record2.reasonType = CheckOutReason.timeout;

      const history = new MachineUsageHistoryT();
      history.records = [record1, record2];

      const request = new UploadUsageRequestT();
      request.history = history;

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

      const validRecord = new MachineUsageT();
      validRecord.sessionId = TEST_SESSION_ID;
      validRecord.checkIn = BigInt(Date.now() - 3600000);
      validRecord.checkOut = BigInt(Date.now());
      validRecord.reasonType = CheckOutReason.self_checkout;

      const invalidRecord = new MachineUsageT();
      // sessionId is missing
      invalidRecord.checkIn = BigInt(Date.now() - 3600000);
      invalidRecord.checkOut = BigInt(Date.now());
      invalidRecord.reasonType = CheckOutReason.self_checkout;

      const history = new MachineUsageHistoryT();
      history.records = [validRecord, invalidRecord];

      const request = new UploadUsageRequestT();
      request.history = history;

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
          metadata: JSON.stringify({ reasonType: CheckOutReason.self_checkout }),
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

      const newRecord = new MachineUsageT();
      newRecord.sessionId = TEST_SESSION_ID;
      newRecord.checkIn = BigInt(Date.now() - 1800000);
      newRecord.checkOut = BigInt(Date.now());
      newRecord.reasonType = CheckOutReason.self_checkout;

      const history = new MachineUsageHistoryT();
      history.records = [newRecord];

      const request = new UploadUsageRequestT();
      request.history = history;

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
