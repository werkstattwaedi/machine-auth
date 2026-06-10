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
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

/**
 * Compile-time shape guard for catalog seed entries — picks up the
 * non-audit catalog fields the picker UI actually reads. If a future
 * `CatalogItemDoc` schema change drops/renames `variants[]` or
 * `category[]`, this typing fails to compile and the seed (and thus the
 * whole e2e suite) breaks loudly at build time instead of silently
 * shipping items the picker can no longer render — the failure mode
 * that produced #285.
 */
type CatalogSeed = Pick<
  CatalogItemDoc,
  | "code"
  | "name"
  | "workshops"
  | "category"
  | "active"
  | "userCanAdd"
  | "variants"
  | "type"
> & { description?: string | null }

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Must match TERMINAL_KEY, DIVERSIFICATION_MASTER_KEY, and
// DIVERSIFICATION_SYSTEM_NAME in functions/.env.local / .env.<project>.
// These are test fixtures, not real secrets — the emulator's copy of
// `.env.local` holds the same values.
const TERMINAL_KEY = "f5e4b999d5aa629f193a874529c4aa2f"
const MASTER_KEY = "c025f541727ecd8b6eb92055c88a2a70"
const SYSTEM_NAME = "Oww8820Maco"
export const NFC_TAG_UID = "04c339aa1e1890"
// Second NFC tag (issue #420 — badge-switch regression). Distinct UID so it
// diversifies to a different SDM key and identifies a different user.
export const NFC_TAG_UID_2 = "04d448bb2f29a1"

const PROJECT_ID = "oww-maco"

// Test user constants
export const AUTH_USER_EMAIL = "e2e-test@werkstattwaedi.ch"
export const AUTH_USER_PASSWORD = "test-password-123"
export const AUTH_USER_ID = "e2e-auth-user-001"
export const NFC_USER_ID = "e2e-nfc-user-001"
export const NFC_USER_ID_2 = "e2e-nfc-user-002"

export default async function globalSetup() {
  const db = getAdminFirestore()

  // ── Clear existing data ──
  await clearEmulatorFirestore()

  // ── Seed pricing config ──
  await db.doc("config/pricing").set({
    // Issue #284: one standard fee per user type; the usage-type discount
    // (hardcoded in @oww/shared) derives ermaessigt / waived rows.
    entryFees: {
      erwachsen: { regular: 15 },
      kind: { regular: 7.5 },
      firma: { regular: 30 },
    },
    // SLA per-layer price (global; resin-per-liter lives on each catalog entry).
    slaLayerPrice: { none: 0.01, member: 0.008 },
    workshops: {
      holz: { label: "Holz", order: 1 },
      // metall pins a MaCo-less machine (issue #105) so the cost step shows
      // an always-visible hours input — exercised by
      // visit-pinned-machines.spec.ts. Kept off `holz` so the existing
      // visit-machine screenshots stay unaffected.
      metall: {
        label: "Metall",
        order: 2,
        pinnedMachines: ["e2e-machine-metall"],
      },
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
  //
  // Catalog items use the v5 schema: `variants[]` carries pricingModel +
  // unitPrice ({ default, member? }), and `category[]` is required (may
  // be empty for items that don't surface category chips). The picker
  // reads `variants[0]` for pricing model and price display; without
  // `variants`, the picker defaults to the "direct" form and the
  // expected labels (Anzahl / Resin / Länge) never render — see #285.
  //
  // `seedCatalog()` is typed against `CatalogSeed` so a future schema
  // change that drops `variants[]` or `category[]` breaks the build
  // here, not in a downstream pixel-diff.
  const seedCatalog = async (id: string, doc: CatalogSeed): Promise<void> => {
    await db.collection("catalog").doc(id).set(doc)
  }

  await seedCatalog("e2e-item-1", {
    code: "9001",
    name: "E2E Testmaterial",
    workshops: ["holz"],
    category: [],
    active: true,
    userCanAdd: true,
    description: "Testmaterial für E2E Tests",
    variants: [
      {
        id: "default",
        pricingModel: "area",
        unitPrice: { default: 10, member: 8 },
      },
    ],
  })

  // Pinned MaCo-less machine for the metall workshop (issue #105). Referenced
  // by `config/pricing.workshops.metall.pinnedMachines`; renders an
  // always-visible hours input on the cost step.
  await seedCatalog("e2e-machine-metall", {
    code: "9100",
    name: "Standbohrmaschine",
    workshops: ["metall"],
    category: ["Maschinen"],
    active: true,
    userCanAdd: false,
    type: "machine",
    description: "Manuelle Stundenerfassung (kein MaCo)",
    variants: [
      {
        id: "default",
        pricingModel: "time",
        unitPrice: { default: 30, member: 15 },
      },
    ],
  })

  await seedCatalog("e2e-item-2", {
    code: "9002",
    name: "E2E Holzplatte",
    workshops: ["holz"],
    category: [],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "default",
        pricingModel: "area",
        unitPrice: { default: 5, member: 4 },
      },
    ],
  })

  await seedCatalog("e2e-item-count", {
    code: "9010",
    name: "Schleifpapier",
    workshops: ["holz"],
    category: [],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "default",
        pricingModel: "count",
        unitPrice: { default: 2, member: 1.5 },
      },
    ],
  })

  await seedCatalog("e2e-item-3", {
    code: "9003",
    name: "Filament",
    workshops: ["makerspace"],
    category: [],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "default",
        pricingModel: "weight",
        unitPrice: { default: 65, member: 65 },
      },
    ],
  })

  await seedCatalog("e2e-item-4", {
    code: "9004",
    name: "Filament (Spezial)",
    workshops: ["makerspace"],
    category: [],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "default",
        pricingModel: "weight",
        unitPrice: { default: 105, member: 105 },
      },
    ],
  })

  await seedCatalog("e2e-item-sla", {
    code: "9099",
    name: "E2E SLA Resin",
    workshops: ["makerspace"],
    category: [],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "default",
        pricingModel: "sla",
        unitPrice: { default: 250, member: 200 },
      },
    ],
  })

  // Multi-variant item used by `/visit/add/item/$code/$variantId`
  // coverage — needs ≥ 2 variants so the variant chooser actually
  // renders (single-variant items never show the chooser per the picker
  // rule).
  await seedCatalog("e2e-item-multivariant", {
    code: "9200",
    name: "E2E Sperrholz",
    workshops: ["holz"],
    category: [],
    active: true,
    userCanAdd: true,
    variants: [
      {
        id: "default",
        label: "Per m²",
        pricingModel: "area",
        unitPrice: { default: 30, member: 25 },
      },
      {
        id: "zuschnitt-a3",
        label: "Zuschnitt A3",
        pricingModel: "count",
        unitPrice: { default: 4, member: 3 },
      },
    ],
  })

  // ── Seed membership catalog + catalog-references indirection ──
  //
  // The /membership page resolves prices via `config/catalog-references`
  // → membership catalog doc → `variants` (`single` and `family`). When
  // these are missing the page renders "—" instead of the price, which
  // shifts text positioning on the "Mitglied werden" card and trips the
  // membership-none screenshot baseline (#285).
  await seedCatalog("e2e-membership", {
    code: "9100",
    name: "Mitgliedschaft",
    workshops: [],
    category: [],
    active: true,
    userCanAdd: false,
    variants: [
      {
        id: "single",
        label: "Einzel",
        pricingModel: "direct",
        unitPrice: { default: 80 },
      },
      {
        id: "family",
        label: "Familie",
        pricingModel: "direct",
        unitPrice: { default: 120 },
      },
    ],
  })

  await db.doc("config/catalog-references").set({
    membership: db.doc("catalog/e2e-membership"),
  })

  // ── Seed permission ──
  await db.collection("permission").doc("laser").set({
    name: "Laser Cutter",
  })

  // ── Seed authenticated test user ──
  // Create Auth user via emulator REST API
  const authUid = await createAuthUser(AUTH_USER_EMAIL, AUTH_USER_PASSWORD)

  // Create matching Firestore user doc. The billingAddress is no longer
  // required for `isProfileComplete` (only firma needs one) — it's kept so the
  // membership/invoice specs have a recipient address to render.
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
    // verify_tag derives the TokenUser.activeMembership boolean from this
    // field. Without it a tag-tapping member would be treated as a non-member
    // and never offered the Sammelrechnung payment tab (issue #414).
    activeMembership: db.doc("memberships/e2e-nfc-membership"),
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

  // ── Second NFC tag + user (issue #420 badge-switch regression) ──
  await db.collection("users").doc(NFC_USER_ID_2).set({
    firstName: "Zweit",
    lastName: "Badge",
    email: "badge2@test.com",
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

  await db.collection("tokens").doc(NFC_TAG_UID_2).set({
    userId: db.doc(`users/${NFC_USER_ID_2}`),
    label: "E2E Test Tag 2",
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
  const { picc: picc2, cmac: cmac2 } = generateValidPICCAndCMAC(
    NFC_TAG_UID_2,
    0,
    TERMINAL_KEY,
    MASTER_KEY,
    SYSTEM_NAME,
  )

  // Write to a temp file so test specs can read the values
  const e2eDataPath = path.resolve(__dirname, ".e2e-data.json")
  writeFileSync(
    e2eDataPath,
    JSON.stringify({ picc, cmac, picc2, cmac2, authUid: authUid }),
  )

  console.log("[e2e] Global setup complete")
  console.log(`[e2e]   Auth user: ${authUid} (${AUTH_USER_EMAIL})`)
  console.log(`[e2e]   NFC tag: picc=${picc.slice(0, 8)}... cmac=${cmac.slice(0, 8)}...`)
  console.log(`[e2e]   NFC tag 2: picc=${picc2.slice(0, 8)}... cmac=${cmac2.slice(0, 8)}...`)
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

