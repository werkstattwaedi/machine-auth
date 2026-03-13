import {
  UploadUsageRequest,
  UploadUsageResponse,
} from "../proto/firebase_rpc/usage.js";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import type {
  MachineEntity,
  CatalogEntity,
  UserEntity,
  DiscountLevel,
} from "../types/firestore_entities.js";

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

  const db = admin.firestore();
  const machineRef = db.collection("machine").doc(machineId);

  // Create usage_machine records from device-uploaded history
  const batch = db.batch();
  const usageRefs: admin.firestore.DocumentReference[] = [];

  for (const record of request.history.records || []) {
    if (!record.userId?.value || !record.authenticationId?.value) {
      logger.warn("Skipping record with missing user or authentication ID");
      continue;
    }

    if (!record.checkOut) {
      logger.warn("Skipping record with no end time (open session)", {
        userId: record.userId.value,
      });
      continue;
    }

    const usageRef = db.collection("usage_machine").doc();
    usageRefs.push(usageRef);
    batch.set(usageRef, {
      userId: db.doc(`users/${record.userId.value}`),
      authenticationId: db.doc(`authentications/${record.authenticationId.value}`),
      machine: machineRef,
      startTime: Timestamp.fromMillis(Number(record.checkIn) * 1000),
      endTime: Timestamp.fromMillis(Number(record.checkOut) * 1000),
      endReason: record.reason?.reason
        ? JSON.stringify({ reason: record.reason.reason.$case })
        : null,
      checkoutItemRef: null, // Will be set by accumulation logic
    });
  }

  await batch.commit();

  // Accumulate usage into checkout items
  await accumulateUsageIntoCheckout(db, machineRef, request);

  logger.info("Successfully processed usage history", {
    totalRecords: request.history.records?.length || 0,
  });

  return { success: true };
}

/**
 * NFC session → checkout item accumulation.
 *
 * For each user in the upload:
 * 1. Look up machine → get workshop + checkoutTemplateId (catalog ref)
 * 2. Find user's open checkout (or create one)
 * 3. Query items subcollection where catalogId == checkoutTemplateId
 * 4. Sum all unlinked usage_machine hours for this catalog entry
 * 5. Update/create checkout item with new totals
 * 6. Set usage_machine.checkoutItemRef to the checkout item
 */
async function accumulateUsageIntoCheckout(
  db: admin.firestore.Firestore,
  machineRef: admin.firestore.DocumentReference,
  request: UploadUsageRequest,
): Promise<void> {
  // Load machine doc to get catalog template and workshop
  const machineDoc = await machineRef.get();
  if (!machineDoc.exists) {
    logger.warn("Machine not found for accumulation", { machineId: machineRef.id });
    return;
  }

  const machineData = machineDoc.data() as MachineEntity;
  if (!machineData.checkoutTemplateId) {
    logger.info("Machine has no checkoutTemplateId, skipping accumulation", {
      machineId: machineRef.id,
    });
    return;
  }

  const catalogRef = machineData.checkoutTemplateId;
  const workshop = machineData.workshop;

  // Guard: checkoutTemplateId must be a DocumentReference
  if (typeof catalogRef?.get !== "function") {
    logger.warn("checkoutTemplateId is not a DocumentReference", {
      machineId: machineRef.id,
      checkoutTemplateId: String(catalogRef),
    });
    return;
  }

  // Load catalog entry for pricing
  const catalogDoc = await catalogRef.get();
  if (!catalogDoc.exists) {
    logger.warn("Catalog entry not found", { catalogId: catalogRef.id });
    return;
  }
  const catalogData = catalogDoc.data() as CatalogEntity;

  // Group records by userId
  const userRecords = new Map<string, NonNullable<typeof request.history>["records"]>();
  for (const record of request.history?.records || []) {
    if (!record.userId?.value) continue;
    const uid = record.userId.value;
    if (!userRecords.has(uid)) userRecords.set(uid, []);
    userRecords.get(uid)!.push(record);
  }

  for (const [userId] of userRecords) {
    try {
      await accumulateForUser(db, userId, catalogRef, catalogData, workshop);
    } catch (error) {
      logger.error("Failed to accumulate usage for user", {
        userId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}

async function accumulateForUser(
  db: admin.firestore.Firestore,
  userId: string,
  catalogRef: admin.firestore.DocumentReference,
  catalogData: CatalogEntity,
  workshop: string,
): Promise<void> {
  const userRef = db.doc(`users/${userId}`);

  // Determine discount level from user roles
  const userDoc = await userRef.get();
  let discountLevel: DiscountLevel = "none";
  if (userDoc.exists) {
    const userData = userDoc.data() as UserEntity;
    if (userData.roles?.includes("vereinsmitglied")) {
      discountLevel = "member";
    }
  }

  const unitPrice = catalogData.unitPrice?.[discountLevel] ?? catalogData.unitPrice?.none ?? 0;

  // Find or create open checkout
  const checkoutsQuery = await db.collection("checkouts")
    .where("userId", "==", userRef)
    .where("status", "==", "open")
    .limit(1)
    .get();

  let checkoutRef: admin.firestore.DocumentReference;
  if (checkoutsQuery.empty) {
    checkoutRef = db.collection("checkouts").doc();
    await checkoutRef.set({
      userId: userRef,
      status: "open",
      usageType: "regular",
      created: Timestamp.now(),
      workshopsVisited: [workshop],
      persons: [],
      modifiedBy: null,
      modifiedAt: Timestamp.now(),
    });
    logger.info("Created open checkout for user", { userId, checkoutId: checkoutRef.id });
  } else {
    checkoutRef = checkoutsQuery.docs[0].ref;
    // Ensure workshop is in workshopsVisited
    const checkoutData = checkoutsQuery.docs[0].data();
    const visited: string[] = checkoutData.workshopsVisited || [];
    if (!visited.includes(workshop)) {
      await checkoutRef.update({
        workshopsVisited: FieldValue.arrayUnion(workshop),
        modifiedAt: Timestamp.now(),
      });
    }
  }

  // Find existing checkout item for this catalog entry
  const itemsQuery = await checkoutRef.collection("items")
    .where("catalogId", "==", catalogRef)
    .limit(1)
    .get();

  // Sum all usage_machine hours for this user + catalog entry (across all machines that share this template)
  // Find all machines that use this catalog template
  const machinesWithTemplate = await db.collection("machine")
    .where("checkoutTemplateId", "==", catalogRef)
    .get();

  const machineRefs = machinesWithTemplate.docs.map(d => d.ref);

  // Query all unlinked usage for this user across machines sharing this catalog template
  const unlinkedDocs: admin.firestore.QueryDocumentSnapshot[] = [];
  let totalHours = 0;
  for (const mRef of machineRefs) {
    const usageQuery = await db.collection("usage_machine")
      .where("userId", "==", userRef)
      .where("machine", "==", mRef)
      .where("checkoutItemRef", "==", null)
      .get();

    for (const usageDoc of usageQuery.docs) {
      unlinkedDocs.push(usageDoc);
      const data = usageDoc.data();
      const startTime = (data.startTime as Timestamp).toMillis();
      const endTime = (data.endTime as Timestamp).toMillis();
      totalHours += (endTime - startTime) / (1000 * 60 * 60);
    }
  }

  // Round to 2 decimal places
  totalHours = Math.round(totalHours * 100) / 100;
  const totalPrice = Math.round(totalHours * unitPrice * 100) / 100;

  let itemRef: admin.firestore.DocumentReference;
  if (itemsQuery.empty) {
    itemRef = await checkoutRef.collection("items").add({
      workshop,
      description: catalogData.name,
      origin: "nfc",
      catalogId: catalogRef,
      created: Timestamp.now(),
      quantity: totalHours,
      unitPrice,
      totalPrice,
    });
  } else {
    itemRef = itemsQuery.docs[0].ref;
    await itemRef.update({
      quantity: totalHours,
      totalPrice,
    });
  }

  // Link all unlinked usage_machine records to the checkout item
  const linkBatch = db.batch();
  for (const usageDoc of unlinkedDocs) {
    linkBatch.update(usageDoc.ref, { checkoutItemRef: itemRef });
  }
  await linkBatch.commit();

  logger.info("Accumulated usage into checkout", {
    userId,
    checkoutId: checkoutRef.id,
    itemId: itemRef.id,
    totalHours,
    totalPrice,
  });
}
