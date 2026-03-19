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

const AUTH_EMULATOR = `http://127.0.0.1:${E2E_PORTS.auth}`

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

/** Fetch OOB codes from Auth emulator (email sign-in links) */
export async function getAuthOobCodes(): Promise<
  { email: string; oobCode: string; oobLink: string; requestType: string }[]
> {
  const res = await fetch(
    `${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/oobCodes`,
  )
  const data = await res.json()
  return data.oobCodes ?? []
}
