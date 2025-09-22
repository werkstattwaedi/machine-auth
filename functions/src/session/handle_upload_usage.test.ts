import { expect } from "chai";
import * as sinon from "sinon";
import { setupFirebaseAdminMock, createFirebaseMocks } from "../testing/firebase-admin-mock";

// Setup Firebase admin mocking
const restoreRequire = setupFirebaseAdminMock();

import { Timestamp } from "firebase-admin/firestore";
import { handleUploadUsage } from "./handle_upload_usage";
import {
  UploadUsageRequestT,
  MachineUsageHistoryT,
  MachineUsageT,
  CheckOutReason,
} from "../fbs";

describe("handleUploadUsage", () => {
  let mocks: any;
  let mockBatch: any;

  beforeEach(() => {
    // Setup Firebase mocks using the utility
    mocks = createFirebaseMocks();
    
    // Create mock batch with proper stub methods
    mockBatch = {
      update: sinon.stub().returnsThis(),
      commit: sinon.stub().resolves(),
    };

    // Add batch to firestore mock
    mocks.mockFirestore.batch = sinon.stub().returns(mockBatch);
  });

  afterEach(() => {
    sinon.restore();
  });

  const createMockUsageRecord = (
    sessionId: string,
    checkIn: number,
    checkOut: number,
    reasonType: CheckOutReason = CheckOutReason.ui
  ): MachineUsageT => {
    const usage = new MachineUsageT();
    usage.sessionId = sessionId;
    usage.checkIn = BigInt(checkIn);
    usage.checkOut = BigInt(checkOut);
    usage.reasonType = reasonType;
    return usage;
  };

  const createMockRequest = (records: MachineUsageT[]): UploadUsageRequestT => {
    const history = new MachineUsageHistoryT();
    history.records = records;
    
    const request = new UploadUsageRequestT();
    request.history = history;
    return request;
  };

  const mockOptions = {
    masterKey: "test-master-key",
    systemName: "test-system",
  };

  describe("input validation", () => {
    it("should throw error for missing usage history", async () => {
      const request = new UploadUsageRequestT();
      // history is undefined
      
      try {
        await handleUploadUsage(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Missing usage history");
      }
    });

    it("should handle empty usage history gracefully", async () => {
      const request = createMockRequest([]);
      
      const response = await handleUploadUsage(request, mockOptions);
      
      expect(response).to.be.an("object");
    });
  });

  describe("usage record processing", () => {
    it("should process single usage record correctly", async () => {
      const checkInTime = 1609459200000; // Jan 1, 2021 00:00:00 UTC
      const checkOutTime = 1609462800000; // Jan 1, 2021 01:00:00 UTC
      const record = createMockUsageRecord("session-abc", checkInTime, checkOutTime, CheckOutReason.ui);
      
      const request = createMockRequest([record]);
      
      await handleUploadUsage(request, mockOptions);
      
      // Verify batch update was called
      expect(mockBatch.update.calledOnce).to.be.true;
      
      // Verify the update data structure
      const updateCall = mockBatch.update.getCall(0);
      const updateData = updateCall.args[1];
      
      expect(updateData).to.have.property("usage");
      expect(updateData.usage).to.have.property("type", "arrayUnion");
      expect(updateData.usage.values).to.be.an("array");
      expect(updateData.usage.values).to.have.length(1);
      
      const usageRecord = updateData.usage.values[0];
      expect(usageRecord).to.have.property("machine", "/machine/unknown");
      expect(usageRecord.checkIn).to.have.property("toMillis");
      expect(usageRecord.checkOut).to.have.property("toMillis");
      expect(usageRecord).to.have.property("metadata");
      
      // Verify timestamps are correct
      expect(usageRecord.checkIn.toMillis()).to.equal(checkInTime);
      expect(usageRecord.checkOut.toMillis()).to.equal(checkOutTime);
      
      // Verify metadata contains reason type
      const metadata = JSON.parse(usageRecord.metadata);
      expect(metadata).to.have.property("reasonType", CheckOutReason.ui);
    });

    it("should group multiple records by session ID", async () => {
      const session1Records = [
        createMockUsageRecord("session-1", 1000, 2000, CheckOutReason.ui),
        createMockUsageRecord("session-1", 3000, 4000, CheckOutReason.timeout),
      ];
      
      const session2Records = [
        createMockUsageRecord("session-2", 5000, 6000, CheckOutReason.self_checkout),
      ];
      
      const allRecords = [...session1Records, ...session2Records];
      const request = createMockRequest(allRecords);
      
      await handleUploadUsage(request, mockOptions);
      
      // Should have two batch updates (one per session)
      expect(mockBatch.update.calledTwice).to.be.true;
      
      // Check first session update
      const firstUpdate = mockBatch.update.getCall(0);
      expect(firstUpdate.args[1].usage.values).to.have.length(2);
      
      // Check second session update
      const secondUpdate = mockBatch.update.getCall(1);
      expect(secondUpdate.args[1].usage.values).to.have.length(1);
    });
  });

  describe("batch operations", () => {
    it("should commit batch operations after processing all records", async () => {
      const records = [
        createMockUsageRecord("session-1", 1000, 2000),
        createMockUsageRecord("session-2", 3000, 4000),
      ];
      
      const request = createMockRequest(records);
      
      await handleUploadUsage(request, mockOptions);
      
      expect(mockBatch.commit.calledOnce).to.be.true;
      expect(mockBatch.commit.calledAfter(mockBatch.update)).to.be.true;
    });

    it("should handle batch operation failures", async () => {
      const record = createMockUsageRecord("session-fail", 1000, 2000);
      const request = createMockRequest([record]);
      
      // Mock batch commit failure
      mockBatch.commit.rejects(new Error("Batch commit failed"));
      
      try {
        await handleUploadUsage(request, mockOptions);
        expect.fail("Expected function to throw");
      } catch (error) {
        expect((error as Error).message).to.equal("Batch commit failed");
      }
    });
  });

  describe("response validation", () => {
    it("should return valid UploadUsageResponseT", async () => {
      const record = createMockUsageRecord("session-response", 1000, 2000);
      const request = createMockRequest([record]);
      
      const response = await handleUploadUsage(request, mockOptions);
      
      expect(response).to.be.an("object");
      expect(response.constructor.name).to.equal("UploadUsageResponseT");
    });
  });
});

// Clean up require mock after all tests
after(() => {
  restoreRequire();
});