// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { initializeApp, getApps, type App } from "firebase-admin/app"
import { getAuth, type Auth } from "firebase-admin/auth"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import type { Page } from "@playwright/test"

const PROJECT_ID = "oww-maco"

// E2E emulator ports — must match playwright.config.ts and firebase.e2e.json
export const E2E_PORTS = {
  auth: 9199,
  firestore: 8180,
  functions: 5101,
}

let app: App
let db: Firestore
let auth: Auth

function ensureApp() {
  if (!app) {
    process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${E2E_PORTS.firestore}`
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${E2E_PORTS.auth}`
    app =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({ projectId: PROJECT_ID })
  }
  return app
}

export function getAdminFirestore(): Firestore {
  if (!db) db = getFirestore(ensureApp())
  return db
}

export function getAdminAuth(): Auth {
  if (!auth) auth = getAuth(ensureApp())
  return auth
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

/**
 * Sign in via the admin app's email-code flow. Leaves the page on whatever
 * post-login destination the app navigates to. Caller is responsible for
 * clearing prior `loginCodes` so the per-email rate limit doesn't bite.
 */
export async function signInWithEmailCode(page: Page, email: string) {
  await page.goto("/login")
  await page.getByTestId("login-email-input").fill(email)
  await page.getByTestId("login-email-submit").click()
  await page.getByTestId("login-code-stage").waitFor({ state: "visible" })

  const entry = await waitForLoginCode(email)
  if (!entry) throw new Error(`No loginCodes debugCode appeared for ${email}`)

  await page.getByTestId("login-code-input").fill(entry.code)
  await page.getByTestId("login-code-submit").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10_000,
  })
}

/**
 * Wait until the Auth user (identified by Firestore doc id == Auth UID)
 * has the given custom claim set by the `syncCustomClaims` Cloud Function.
 * The trigger fires asynchronously after a Firestore write, so global
 * setup blocks here before yielding control to the spec.
 */
export async function waitForCustomClaim(
  uid: string,
  claim: string,
  expected: unknown = true,
  { timeoutMs = 10_000, intervalMs = 200 } = {},
): Promise<void> {
  const auth = getAdminAuth()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const user = await auth.getUser(uid)
    if ((user.customClaims ?? {})[claim] === expected) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(
    `Custom claim ${claim}=${expected} did not propagate to ${uid} within ${timeoutMs}ms`,
  )
}
