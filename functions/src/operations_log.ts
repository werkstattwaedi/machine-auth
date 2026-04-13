// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Reusable operations log for tracking errors and warnings on entities.
 *
 * Writes to the top-level `operations_log` collection. Only errors and
 * warnings are logged — successful operations are silent.
 */

import * as logger from "firebase-functions/logger";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

export interface OperationsLogEntry {
  collection: string;
  docId: string;
  operation: string;
  severity: "error" | "warning";
  message: string;
  timestamp: Timestamp;
}

export async function logOperationError(
  collection: string,
  docId: string,
  operation: string,
  message: string,
): Promise<void> {
  const entry: OperationsLogEntry = {
    collection,
    docId,
    operation,
    severity: "error",
    message,
    timestamp: Timestamp.now(),
  };

  try {
    await getFirestore().collection("operations_log").add(entry);
  } catch (err) {
    // Don't let logging failures propagate — just log to Cloud Logging
    logger.error("Failed to write operations log", { collection, docId, operation, err });
  }
}

export async function logOperationWarning(
  collection: string,
  docId: string,
  operation: string,
  message: string,
): Promise<void> {
  const entry: OperationsLogEntry = {
    collection,
    docId,
    operation,
    severity: "warning",
    message,
    timestamp: Timestamp.now(),
  };

  try {
    await getFirestore().collection("operations_log").add(entry);
  } catch (err) {
    logger.error("Failed to write operations log", { collection, docId, operation, err });
  }
}
