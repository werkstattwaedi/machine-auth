// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Helper for integration tests that run against the Firebase emulator.
 *
 * Usage:
 *   before(async () => { await setupEmulator() })
 *   afterEach(async () => { await clearFirestore() })
 *   after(async () => { await teardownEmulator() })
 */

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing"
import { initializeApp, deleteApp, type App } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"

let testEnv: RulesTestEnvironment
let adminApp: App
let adminDb: Firestore

const PROJECT_ID = "test-project"

export async function setupEmulator(): Promise<void> {
  // Read port from env (set by firebase emulators:exec) or default
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"
  const [hostAddr, portStr] = host.split(":")
  const port = parseInt(portStr ?? "8080")

  process.env.FIRESTORE_EMULATOR_HOST = host

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: hostAddr, port },
  })

  adminApp = initializeApp({ projectId: PROJECT_ID })
  adminDb = getFirestore(adminApp)
}

export async function clearFirestore(): Promise<void> {
  if (testEnv) {
    await testEnv.clearFirestore()
  }
}

export async function teardownEmulator(): Promise<void> {
  if (testEnv) await testEnv.cleanup()
  if (adminApp) await deleteApp(adminApp)
}

export function getAdminFirestore(): Firestore {
  return adminDb
}

/**
 * Seed a document into the emulator via the admin SDK.
 * Automatically converts string paths starting with "/" to DocumentReferences.
 */
export async function seedDoc(
  collectionPath: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const converted = convertRefs(data, adminDb)
  await adminDb.collection(collectionPath).doc(docId).set(converted)
}

function convertRefs(
  obj: Record<string, unknown>,
  db: Firestore,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.startsWith("/")) {
      result[key] = db.doc(value)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === "string" && item.startsWith("/")) {
          return db.doc(item)
        }
        return item
      })
    } else if (value && typeof value === "object" && !(value instanceof Date)) {
      result[key] = convertRefs(value as Record<string, unknown>, db)
    } else {
      result[key] = value
    }
  }
  return result
}
