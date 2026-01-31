import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

let testEnv: RulesTestEnvironment;

/**
 * Initialize the Firebase emulator test environment
 */
export async function setupEmulator(): Promise<RulesTestEnvironment> {
  testEnv = await initializeTestEnvironment({
    projectId: "test-project",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
    },
  });

  // Initialize Firebase Admin SDK to connect to emulator
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: "test-project",
    });
  }

  // Connect admin SDK to emulator
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }

  return testEnv;
}

/**
 * Clear all Firestore data between tests
 */
export async function clearFirestore(): Promise<void> {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
}

/**
 * Cleanup and shutdown emulator
 */
export async function teardownEmulator(): Promise<void> {
  if (testEnv) {
    await testEnv.cleanup();
  }
}

/**
 * Convert string references to DocumentReferences
 * Special handling for permissions array - converts permission IDs to references
 */
function convertReferencesToDocRefs(obj: any, db: admin.firestore.Firestore, key?: string): any {
  if (typeof obj === 'string' && obj.startsWith('/')) {
    // It's a reference path like "/users/abc123" - convert to DocumentReference
    return db.doc(obj);
  } else if (Array.isArray(obj)) {
    // Special handling for permissions array
    if (key === 'permissions') {
      return obj.map(item => {
        if (typeof item === 'string') {
          // Convert permission ID to DocumentReference
          if (item.startsWith('/')) {
            return db.doc(item);
          } else {
            // It's just an ID like "laser" - convert to "/permission/laser"
            return db.doc(`/permission/${item}`);
          }
        }
        return convertReferencesToDocRefs(item, db);
      });
    }
    // Recursively process array elements
    return obj.map(item => convertReferencesToDocRefs(item, db));
  } else if (obj && typeof obj === 'object' && !(obj instanceof Timestamp)) {
    // Recursively process object properties (but skip Timestamps)
    const converted: any = {};
    for (const [k, value] of Object.entries(obj)) {
      converted[k] = convertReferencesToDocRefs(value, db, k);
    }
    return converted;
  }
  return obj;
}

/**
 * Seed test data into Firestore
 * Automatically converts string references like "/users/abc" to DocumentReferences
 */
export async function seedTestData(data: {
  permissions?: Record<string, any>;
  tokens?: Record<string, any>;
  users?: Record<string, any>;
  machines?: Record<string, any>;
  authentications?: Record<string, any>;
}): Promise<void> {
  const db = admin.firestore();

  // Seed permissions first (other collections may reference them)
  if (data.permissions) {
    for (const [permissionId, permissionData] of Object.entries(data.permissions)) {
      await db.collection("permission").doc(permissionId).set(permissionData);
    }
  }

  // Seed users (convert string references to DocumentReferences)
  if (data.users) {
    for (const [userId, userData] of Object.entries(data.users)) {
      const converted = convertReferencesToDocRefs(userData, db);
      await db.collection("users").doc(userId).set({
        created: Timestamp.now(),
        ...converted,
      });
    }
  }

  // Seed tokens (convert string references to DocumentReferences)
  if (data.tokens) {
    for (const [tokenId, tokenData] of Object.entries(data.tokens)) {
      const converted = convertReferencesToDocRefs(tokenData, db);
      await db.collection("tokens").doc(tokenId).set({
        registered: Timestamp.now(),
        deactivated: null,
        ...converted,
      });
    }
  }

  // Seed machines (convert string references to DocumentReferences)
  if (data.machines) {
    for (const [machineId, machineData] of Object.entries(data.machines)) {
      const converted = convertReferencesToDocRefs(machineData, db);
      await db.collection("machine").doc(machineId).set(converted);
    }
  }

  // Seed authentications (convert string references to DocumentReferences)
  if (data.authentications) {
    for (const [authId, authData] of Object.entries(data.authentications)) {
      const converted = convertReferencesToDocRefs(authData, db);
      await db.collection("authentications").doc(authId).set({
        created: Timestamp.now(),
        ...converted,
      });
    }
  }
}

/**
 * Get a Firestore instance connected to the emulator
 */
export function getFirestore() {
  return admin.firestore();
}
