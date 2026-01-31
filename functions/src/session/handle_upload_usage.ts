import {
  UploadUsageRequest,
  UploadUsageResponse,
} from "../proto/firebase_rpc/usage.js";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

export async function handleUploadUsage(
  request: UploadUsageRequest,
  _options: {
    masterKey: string;
    systemName: string;
  }
): Promise<UploadUsageResponse> {
  logger.info("Processing upload usage request");

  if (!request.history) {
    throw new Error("Missing usage history");
  }

  logger.info("Processing usage history with", {
    recordCount: request.history.records?.length || 0,
    machineId: request.history.machineId?.value,
  });

  const machineId = request.history.machineId?.value;
  if (!machineId) {
    throw new Error("Missing machine ID in usage history");
  }

  const machineRef = admin.firestore().collection("machine").doc(machineId);

  // Create usage records in the new usage collection
  const batch = admin.firestore().batch();

  for (const record of request.history.records || []) {
    if (!record.userId?.value || !record.authenticationId?.value) {
      logger.warn("Skipping record with missing user or authentication ID");
      continue;
    }

    const usageRef = admin.firestore().collection("usage").doc();
    batch.set(usageRef, {
      userId: admin.firestore().doc(`users/${record.userId.value}`),
      authenticationId: admin.firestore().doc(`authentications/${record.authenticationId.value}`),
      machine: machineRef,
      checkIn: admin.firestore.Timestamp.fromMillis(Number(record.checkIn) * 1000),
      checkOut: record.checkOut
        ? admin.firestore.Timestamp.fromMillis(Number(record.checkOut) * 1000)
        : null,
      checkOutReason: record.reason?.reason
        ? JSON.stringify({ reason: record.reason.reason.$case })
        : null,
      checkout: null, // Not paid yet
    });
  }

  await batch.commit();

  logger.info("Successfully processed usage history", {
    totalRecords: request.history.records?.length || 0,
  });

  return { success: true };
}
