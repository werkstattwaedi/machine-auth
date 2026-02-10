// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { getFirestore, Timestamp, DocumentReference } from "firebase-admin/firestore";
import {
  onDocumentWritten,
  type FirestoreEvent,
  type Change,
  type DocumentSnapshot,
} from "firebase-functions/v2/firestore";

/**
 * Serialize a Firestore value for audit log storage.
 * - DocumentReferences become path strings
 * - Timestamps become ISO strings
 * - Nested objects/arrays are recursively serialized
 */
function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof DocumentReference) return value.path;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = serializeValue(v);
    }
    return result;
  }
  return value;
}

function serializeDoc(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!data) return null;
  return serializeValue(data) as Record<string, unknown>;
}

async function handleAuditEvent(
  collectionName: string,
  event: FirestoreEvent<Change<DocumentSnapshot> | undefined, Record<string, string>>
) {
  const docId = Object.values(event.params)[0]; // first param is always the doc ID
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();

  let operation: "create" | "update" | "delete";
  if (!before || !event.data?.before?.exists) {
    operation = "create";
  } else if (!after || !event.data?.after?.exists) {
    operation = "delete";
  } else {
    operation = "update";
  }

  // Extract actor from modifiedBy field on the after snapshot
  const actorUid = (after?.modifiedBy as string) ?? null;

  try {
    const db = getFirestore();
    await db.collection("audit_log").add({
      collection: collectionName,
      docId,
      operation,
      actorUid,
      before: serializeDoc(before),
      after: serializeDoc(after),
      timestamp: Timestamp.now(),
    });
  } catch (error) {
    logger.error(`Audit log write failed for ${collectionName}/${docId}`, error);
  }
}

/**
 * Create an audit trigger for a given collection.
 */
function createAuditTrigger(collectionName: string, documentPattern: string) {
  return onDocumentWritten(documentPattern, (event) =>
    handleAuditEvent(collectionName, event)
  );
}

// Export individual triggers for each audited collection
export const auditUsers = createAuditTrigger("users", "users/{docId}");
export const auditTokens = createAuditTrigger("tokens", "tokens/{docId}");
export const auditMachine = createAuditTrigger("machine", "machine/{docId}");
export const auditPermission = createAuditTrigger("permission", "permission/{docId}");
export const auditMaco = createAuditTrigger("maco", "maco/{docId}");
export const auditUsageMachine = createAuditTrigger("usage_machine", "usage_machine/{docId}");
export const auditUsageMaterial = createAuditTrigger("usage_material", "usage_material/{docId}");
export const auditCheckouts = createAuditTrigger("checkouts", "checkouts/{docId}");
export const auditMaterials = createAuditTrigger("materials", "materials/{docId}");
