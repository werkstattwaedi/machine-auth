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
import { getAuth } from "firebase-admin/auth"
import { generateValidPICCAndCMAC } from "./sdm-test-helper"
import { E2E_CATALOG_DOCS } from "./catalog-fixtures"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Must match TERMINAL_KEY, DIVERSIFICATION_MASTER_KEY, and
// DIVERSIFICATION_SYSTEM_NAME in functions/.env.local / .env.<project>.
// These are test fixtures, not real secrets — the emulator's copy of
// `.env.local` holds the same values.
const TERMINAL_KEY = "f5e4b999d5aa629f193a874529c4aa2f"
const MASTER_KEY = "c025f541727ecd8b6eb92055c88a2a70"
const SYSTEM_NAME = "Oww8820Maco"
export const NFC_TAG_UID = "04c339aa1e1890"

const PROJECT_ID = "oww-maco"

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
      erwachsen: { regular: 15, ermaessigt: 7.5, materialbezug: 0, intern: 0, hangenmoos: 15 },
      kind: { regular: 7.5, ermaessigt: 3.75, materialbezug: 0, intern: 0, hangenmoos: 7.5 },
      firma: { regular: 30, ermaessigt: 15, materialbezug: 0, intern: 0, hangenmoos: 30 },
    },
    // SLA per-layer price (global; resin-per-liter lives on each catalog entry).
    slaLayerPrice: { none: 0.01, member: 0.008 },
    workshops: {
      holz: { label: "Holz", order: 1 },
      metall: { label: "Metall", order: 2 },
      textil: { label: "Textil", order: 3 },
      keramik: { label: "Keramik", order: 4 },
      schmuck: { label: "Schmuck", order: 5 },
      glas: { label: "Glas", order: 6 },
      stein: { label: "Stein", order: 7 },
      malen: { label: "Malen und Basteln", order: 8 },
      makerspace: { label: "Maker Space", order: 9 },
      diverses: { label: "Diverses", order: 10 },
    },
    labels: {
      units: { h: "Std.", m2: "m²", m: "m", stk: "Stk.", kg: "kg", chf: "CHF" },
      discounts: { none: "Normal", member: "Mitglied" },
    },
  })

  // ── Seed catalog items ──
  for (const [id, doc] of Object.entries(E2E_CATALOG_DOCS)) {
    await db.collection("catalog").doc(id).set(doc)
  }

  // ── Seed permission ──
  await db.collection("permission").doc("laser").set({
    name: "Laser Cutter",
  })

  // ── Seed authenticated test user ──
  // Create Auth user via emulator REST API
  const authUid = await createAuthUser(AUTH_USER_EMAIL, AUTH_USER_PASSWORD)

  // Create matching Firestore user doc.
  // billingAddress is required for `isProfileComplete` — without it, member
  // area routes redirect to /complete-profile.
  await db.collection("users").doc(authUid).set({
    firstName: "E2E",
    lastName: "Testuser",
    email: AUTH_USER_EMAIL,
    roles: ["vereinsmitglied"],
    permissions: [db.doc("permission/laser")],
    userType: "erwachsen",
    billingAddress: {
      company: "",
      street: "Seestrasse 12",
      zip: "8820",
      city: "Wädenswil",
    },
    termsAcceptedAt: FieldValue.serverTimestamp(),
    created: FieldValue.serverTimestamp(),
  })

  // Store the Auth UID for tests to use
  process.env.E2E_AUTH_USER_UID = authUid

  // ── Seed NFC tag test data ──
  await db.collection("users").doc(NFC_USER_ID).set({
    firstName: "NFC",
    lastName: "Tester",
    email: "nfc@test.com",
    roles: ["vereinsmitglied"],
    permissions: [db.doc("permission/laser")],
    userType: "erwachsen",
    billingAddress: {
      company: "",
      street: "Seestrasse 12",
      zip: "8820",
      city: "Wädenswil",
    },
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
  // Pin the UID via the Admin SDK so the seed-derived Avatar colour stays
  // identical across runs — the REST `accounts:signUp` endpoint generates
  // a random localId, which made screenshot baselines flaky.
  const auth = getAuth()
  try {
    const user = await auth.createUser({
      uid: AUTH_USER_ID,
      email,
      password,
      emailVerified: true,
    })
    return user.uid
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "auth/uid-already-exists"
    ) {
      return AUTH_USER_ID
    }
    throw err
  }
}

