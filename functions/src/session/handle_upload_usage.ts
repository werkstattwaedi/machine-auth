import {
  UploadUsageRequestT,
  UploadUsageResponseT,
} from "../fbs";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

export async function handleUploadUsage(
  request: UploadUsageRequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<UploadUsageResponseT> {
  logger.info("Processing upload usage request");

  if (!request.history) {
    throw new Error("Missing usage history");
  }

  logger.info("Processing usage history with", {
    recordCount: request.history.records?.length || 0,
  });

  // Group records by sessionId for efficient updates
  const recordsBySession = new Map<string, any[]>();

  for (const record of request.history.records || []) {
    if (!record.sessionId) {
      logger.warn("Skipping record with missing session ID");
      continue;
    }

    const sessionId = record.sessionId as string;
    if (!recordsBySession.has(sessionId)) {
      recordsBySession.set(sessionId, []);
    }

    // Convert usage record to the schema format
    recordsBySession.get(sessionId)!.push({
      machine: `/machine/unknown`, // Machine ID not provided in current schema, could be added later
      checkIn: admin.firestore.Timestamp.fromMillis(Number(record.checkIn)),
      checkOut: admin.firestore.Timestamp.fromMillis(Number(record.checkOut)),
      metadata: JSON.stringify({
        reasonType: record.reasonType,
        // Add any other metadata from the record
      })
    });
  }

  // Update each session by appending usage records
  const batch = admin.firestore().batch();

  for (const [sessionId, usageRecords] of recordsBySession) {
    // Verify session exists before updating
    const sessionRef = admin.firestore().collection("sessions").doc(sessionId);
    
    // Add usage records to the session
    batch.update(sessionRef, {
      usage: admin.firestore.FieldValue.arrayUnion(...usageRecords)
    });
  }

  await batch.commit();

  logger.info("Successfully processed usage history", {
    sessionsUpdated: recordsBySession.size,
    totalRecords: request.history.records?.length || 0,
  });

  // Create success response
  const response = new UploadUsageResponseT();
  response.success = true;

  return response;
}
