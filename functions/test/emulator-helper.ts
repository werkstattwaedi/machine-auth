import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertSucceeds,
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
  const db = admin.firestore();
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
 * Seed test data into Firestore
 */
export async function seedTestData(data: {
  tokens?: Record<string, any>;
  users?: Record<string, any>;
  sessions?: Record<string, any>;
  machines?: Record<string, any>;
}): Promise<void> {
  const db = admin.firestore();

  // Seed tokens
  if (data.tokens) {
    for (const [tokenId, tokenData] of Object.entries(data.tokens)) {
      await db.collection("tokens").doc(tokenId).set({
        registered: Timestamp.now(),
        deactivated: null,
        ...tokenData,
      });
    }
  }

  // Seed users
  if (data.users) {
    for (const [userId, userData] of Object.entries(data.users)) {
      await db.collection("users").doc(userId).set({
        created: Timestamp.now(),
        ...userData,
      });
    }
  }

  // Seed sessions
  if (data.sessions) {
    for (const [sessionId, sessionData] of Object.entries(data.sessions)) {
      await db.collection("sessions").doc(sessionId).set(sessionData);
    }
  }

  // Seed machines
  if (data.machines) {
    for (const [machineId, machineData] of Object.entries(data.machines)) {
      await db.collection("machine").doc(machineId).set(machineData);
    }
  }
}

/**
 * Get a Firestore instance connected to the emulator
 */
export function getFirestore() {
  return admin.firestore();
}
