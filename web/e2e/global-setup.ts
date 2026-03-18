// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Playwright global setup: seed Firebase emulators with test data.
 *
 * Runs once before all test files. Emulators must already be running
 * (started by the `firebase emulators:exec` wrapper script).
 */

import { writeFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { getAdminFirestore, E2E_PORTS } from "./helpers"
import { FieldValue } from "firebase-admin/firestore"
import { generateValidPICCAndCMAC } from "./sdm-test-helper"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Must match TERMINAL_KEY, DIVERSIFICATION_MASTER_KEY, and
// DIVERSIFICATION_SYSTEM_NAME in functions/.env.local
const TERMINAL_KEY = "f5e4b999d5aa629f193a874529c4aa2f"
const MASTER_KEY = "c025f541727ecd8b6eb92055c88a2a70"
const SYSTEM_NAME = "OwwMachineAuth"
const NFC_TAG_UID = "04c339aa1e1890"

const PROJECT_ID = "oww-maschinenfreigabe"
const AUTH_EMULATOR = `http://127.0.0.1:${E2E_PORTS.auth}`

// Test user constants
export const AUTH_USER_EMAIL = "e2e-test@werkstattwaedi.ch"
export const AUTH_USER_PASSWORD = "test-password-123"
export const AUTH_USER_ID = "e2e-auth-user-001"
export const NFC_USER_ID = "e2e-nfc-user-001"

export default async function globalSetup() {
  const db = getAdminFirestore()

  // ── Clear existing data ──
  await clearEmulatorFirestore()

  // ── Seed pricing config ──
  await db.doc("config/pricing").set({
    entryFees: {
      erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
      kind: { regular: 7.5, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
      firma: { regular: 30, materialbezug: 0, intern: 0, hangenmoos: 30 },
    },
    workshops: {
      holz: { label: "Holz", order: 1 },
      metall: { label: "Metall", order: 2 },
    },
    labels: {
      units: { h: "Std.", m2: "m²", m: "m", stk: "Stk.", kg: "kg", chf: "CHF" },
      discounts: { none: "Normal", member: "Mitglied", intern: "Intern" },
    },
  })

  // ── Seed catalog items ──
  await db.collection("catalog").doc("e2e-item-1").set({
    code: "9001",
    name: "E2E Testmaterial",
    workshops: ["holz"],
    pricingModel: "count",
    unitPrice: { none: 10, member: 8, intern: 0 },
    active: true,
    userCanAdd: true,
    description: "Testmaterial für E2E Tests",
  })

  await db.collection("catalog").doc("e2e-item-2").set({
    code: "9002",
    name: "E2E Holzplatte",
    workshops: ["holz"],
    pricingModel: "area",
    unitPrice: { none: 5, member: 4, intern: 0 },
    active: true,
    userCanAdd: true,
  })

  // ── Seed permission ──
  await db.collection("permission").doc("laser").set({
    name: "Laser Cutter",
  })

  // ── Seed authenticated test user ──
  // Create Auth user via emulator REST API
  const authUid = await createAuthUser(AUTH_USER_EMAIL, AUTH_USER_PASSWORD)

  // Create matching Firestore user doc
  await db.collection("users").doc(authUid).set({
    displayName: "E2E Testuser",
    name: "E2E Testuser",
    email: AUTH_USER_EMAIL,
    roles: ["vereinsmitglied"],
    permissions: [db.doc("permission/laser")],
    userType: "erwachsen",
    termsAcceptedAt: FieldValue.serverTimestamp(),
    created: FieldValue.serverTimestamp(),
  })

  // Store the Auth UID for tests to use
  process.env.E2E_AUTH_USER_UID = authUid

  // ── Seed NFC tag test data ──
  await db.collection("users").doc(NFC_USER_ID).set({
    displayName: "NFC Tester",
    name: "NFC Tester",
    email: "nfc@test.com",
    roles: ["vereinsmitglied"],
    permissions: [db.doc("permission/laser")],
    userType: "erwachsen",
    termsAcceptedAt: FieldValue.serverTimestamp(),
    created: FieldValue.serverTimestamp(),
  })

  await db.collection("tokens").doc(NFC_TAG_UID).set({
    userId: db.doc(`users/${NFC_USER_ID}`),
    label: "E2E Test Tag",
    deactivated: null,
    registered: FieldValue.serverTimestamp(),
  })

  // Generate valid picc+cmac
  const { picc, cmac } = generateValidPICCAndCMAC(
    NFC_TAG_UID,
    0,
    TERMINAL_KEY,
    MASTER_KEY,
    SYSTEM_NAME,
  )

  // Write to a temp file so test specs can read the values
  const e2eDataPath = path.resolve(__dirname, ".e2e-data.json")
  writeFileSync(e2eDataPath, JSON.stringify({ picc, cmac, authUid: authUid }))

  console.log("[e2e] Global setup complete")
  console.log(`[e2e]   Auth user: ${authUid} (${AUTH_USER_EMAIL})`)
  console.log(`[e2e]   NFC tag: picc=${picc.slice(0, 8)}... cmac=${cmac.slice(0, 8)}...`)
}

async function clearEmulatorFirestore() {
  // Use emulator REST API to clear all data
  await fetch(
    `http://127.0.0.1:${E2E_PORTS.firestore}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  )
}

async function createAuthUser(email: string, password: string): Promise<string> {
  // Try to create user
  const createRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )

  if (createRes.ok) {
    const data = await createRes.json()
    return data.localId
  }

  // User already exists — sign in to get the UID
  const signInRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )

  if (!signInRes.ok) {
    const err = await signInRes.text()
    throw new Error(`Failed to create or sign in Auth user: ${err}`)
  }

  const data = await signInRes.json()
  return data.localId
}

