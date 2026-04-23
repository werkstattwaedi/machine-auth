// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { initializeApp, getApps, type App } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"

const PROJECT_ID = "oww-maco"

// E2E emulator ports — must match playwright.config.ts and firebase.e2e.json
export const E2E_PORTS = {
  auth: 9199,
  firestore: 8180,
  functions: 5101,
}

let app: App
let db: Firestore

export function getAdminFirestore(): Firestore {
  if (!db) {
    process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${E2E_PORTS.firestore}`
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${E2E_PORTS.auth}`

    app = getApps().length > 0
      ? getApps()[0]
      : initializeApp({ projectId: PROJECT_ID })
    db = getFirestore(app)
  }
  return db
}

/** Clear all documents in specific collections */
export async function clearCollections(...names: string[]) {
  const db = getAdminFirestore()
  for (const name of names) {
    const snap = await db.collection(name).get()
    const batch = db.batch()
    snap.docs.forEach((doc) => batch.delete(doc.ref))
    if (snap.size > 0) await batch.commit()
  }
}

/** Query checkout docs (most recent first) */
export async function getCheckoutDocs() {
  const db = getAdminFirestore()
  const snap = await db.collection("checkouts").orderBy("created", "desc").get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Get items subcollection for a checkout */
export async function getCheckoutItems(checkoutId: string) {
  const db = getAdminFirestore()
  const snap = await db.collection(`checkouts/${checkoutId}/items`).get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Get a user document by Auth UID */
export async function getUserDoc(uid: string) {
  const db = getAdminFirestore()
  const snap = await db.collection("users").doc(uid).get()
  return snap.exists ? snap.data() : null
}

export type LoginCodeEntry = {
  docId: string
  code: string
}

/** Poll Firestore for the latest unconsumed loginCodes doc for an email.
 *  requestLoginCode runs in the Functions emulator and writes `debugCode`
 *  (plaintext code) because FUNCTIONS_EMULATOR === "true". */
export async function waitForLoginCode(
  email: string,
  { timeoutMs = 5000, intervalMs = 150 } = {},
): Promise<LoginCodeEntry | undefined> {
  const db = getAdminFirestore()
  const normalized = email.trim().toLowerCase()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snap = await db
      .collection("loginCodes")
      .where("email", "==", normalized)
      .orderBy("created", "desc")
      .limit(1)
      .get()
    if (!snap.empty) {
      const doc = snap.docs[0]
      const data = doc.data()
      if (!data.consumedAt && typeof data.debugCode === "string") {
        return { docId: doc.id, code: data.debugCode as string }
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return undefined
}
