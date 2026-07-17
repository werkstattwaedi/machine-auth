// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Playwright global setup for the admin app: seed Firebase emulators
 * with an admin, a non-admin, and a couple of regular users that the
 * specs filter / sort / drill into. Runs once before any spec.
 *
 * Emulators must already be running (started by `firebase emulators:exec`
 * via `scripts/emulator-exec.sh` from the root `npm run test:web:e2e`).
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore"
import {
  getAdminAuth,
  getAdminFirestore,
  waitForCustomClaim,
  E2E_PORTS,
} from "./helpers"

const PROJECT_ID = "oww-maco"

// Seeded user identities. Admin/non-admin emails MUST be unique per spec
// run because the magic-code rate limit is keyed on email.
export const ADMIN_EMAIL = "admin-e2e@werkstattwaedi.ch"
export const NON_ADMIN_EMAIL = "member-e2e@werkstattwaedi.ch"

// Pin the auth UIDs so the seed-derived Avatar colour is stable across
// runs — otherwise screenshot baselines are flaky.
export const ADMIN_UID = "e2e-admin-user-001"
export const NON_ADMIN_UID = "e2e-member-user-001"

// Seeded "directory" users — appear in the user list, not signed in.
export const SEEDED_DIRECTORY_USERS = [
  {
    id: "e2e-dir-anna",
    firstName: "Anna",
    lastName: "Architektin",
    email: "anna@werkstattwaedi.ch",
    roles: ["vereinsmitglied"],
    permissions: [] as string[],
  },
  {
    id: "e2e-dir-bruno",
    firstName: "Bruno",
    lastName: "Bastler",
    email: "bruno@werkstattwaedi.ch",
    roles: ["vereinsmitglied"],
    permissions: ["laser"],
  },
] as const

// Permission seed used by both list and grant tests.
export const SEEDED_PERMISSION_ID = "laser"
export const SEEDED_PERMISSION_NAME = "Laser Cutter"

// Test fixture: a permission that the admin will grant to a directory user.
export const GRANTABLE_PERMISSION_ID = "fraese"
export const GRANTABLE_PERMISSION_NAME = "CNC Fräse"

// Directory user that starts without `fraese` and receives it in the grant test.
export const GRANT_TARGET_USER_ID = SEEDED_DIRECTORY_USERS[0].id

// ── Workflow seed (machines / visits / usage / bills / membership) ──
//
// Dates are FIXED so screenshot baselines stay byte-stable. The one
// exception is the "open" bill: its status derives from created+30d vs
// now, so it must stay inside the payment window forever → created is
// seeded relative to now and its date cell gets masked in screenshots.
export const MACHINE_LASER_ID = "e2e-laser"
export const MACHINE_CNC_ID = "e2e-cnc"
export const OPEN_REPORT_MESSAGE = "Achse klemmt beim Verfahren"

export const VISIT_CLOSED_ID = "e2e-visit-closed"
export const VISIT_OPEN_ID = "e2e-visit-open"

export const BILL_OPEN_ID = "e2e-bill-open"
export const BILL_OVERDUE_ID = "e2e-bill-overdue"
export const BILL_PAID_ID = "e2e-bill-paid"
export const BILL_OPEN_REFERENCE = 2041
export const BILL_OVERDUE_REFERENCE = 2036

export const MEMBERSHIP_ID = "e2e-membership-anna"

export const CATALOG_AHORN_ID = "e2e-cat-ahorn"
export const CATALOG_EICHE_ID = "e2e-cat-eiche"
export const PRICE_LIST_ID = "e2e-pricelist-holz"

export default async function globalSetup() {
  // Pure-render specs (e.g. label-preview-screenshot) don't need Auth or
  // Firestore. Set PLAYWRIGHT_SKIP_GLOBAL_SETUP=1 to skip the emulator
  // setup entirely — the spec runner still gets a Vite dev server via
  // webServer, which is all those specs need.
  if (process.env.PLAYWRIGHT_SKIP_GLOBAL_SETUP === "1") {
    console.log("[global-setup] Skipped (PLAYWRIGHT_SKIP_GLOBAL_SETUP=1)")
    return
  }

  const db = getAdminFirestore()

  await clearEmulatorFirestore()
  await clearEmulatorAuth()

  // ── Permissions ──
  await db.collection("permission").doc(SEEDED_PERMISSION_ID).set({
    name: SEEDED_PERMISSION_NAME,
  })
  await db.collection("permission").doc(GRANTABLE_PERMISSION_ID).set({
    name: GRANTABLE_PERMISSION_NAME,
  })

  // ── Auth users ──
  const adminUid = await createAuthUser(ADMIN_EMAIL, ADMIN_UID)
  const memberUid = await createAuthUser(NON_ADMIN_EMAIL, NON_ADMIN_UID)

  // ── Firestore user docs ──
  // Admin user — receives the `admin` role; syncCustomClaims will set the
  // matching custom claim asynchronously, which we wait for below.
  await db
    .collection("users")
    .doc(adminUid)
    .set({
      firstName: "Admin",
      lastName: "Tester",
      email: ADMIN_EMAIL,
      roles: ["admin", "vereinsmitglied"],
      permissions: [],
      userType: "erwachsen",
      termsAcceptedAt: FieldValue.serverTimestamp(),
      created: FieldValue.serverTimestamp(),
    })

  // Non-admin member — used to verify the admin gate redirects.
  await db
    .collection("users")
    .doc(memberUid)
    .set({
      firstName: "Member",
      lastName: "Tester",
      email: NON_ADMIN_EMAIL,
      roles: ["vereinsmitglied"],
      permissions: [],
      userType: "erwachsen",
      termsAcceptedAt: FieldValue.serverTimestamp(),
      created: FieldValue.serverTimestamp(),
    })

  // Directory users — populate the user list table.
  for (const u of SEEDED_DIRECTORY_USERS) {
    await db
      .collection("users")
      .doc(u.id)
      .set({
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        roles: u.roles,
        permissions: u.permissions.map((id) => db.doc(`permission/${id}`)),
        userType: "erwachsen",
        termsAcceptedAt: FieldValue.serverTimestamp(),
        created: FieldValue.serverTimestamp(),
      })
  }

  await seedWorkflowData()

  // Wait for the custom-claim trigger to flip the admin's claim. Without
  // this, the first request from the admin spec would race the trigger and
  // fail Firestore rule checks that key off `request.auth.token.admin`.
  await waitForCustomClaim(adminUid, "admin", true)

  process.env.E2E_ADMIN_UID = adminUid
  process.env.E2E_MEMBER_UID = memberUid

  console.log("[admin-e2e] Global setup complete")
  console.log(`[admin-e2e]   Admin user: ${adminUid} (${ADMIN_EMAIL})`)
  console.log(`[admin-e2e]   Member user: ${memberUid} (${NON_ADMIN_EMAIL})`)
}

/**
 * Seed data for the workflow workspaces: machines (one blocked, one with
 * an open Meldung), a family membership, visits + machine usage, bills in
 * every payment state, catalog items and a stale price list.
 */
async function seedWorkflowData() {
  const db = getAdminFirestore()
  const ts = (iso: string) => Timestamp.fromDate(new Date(iso))
  const anna = SEEDED_DIRECTORY_USERS[0].id
  const bruno = SEEDED_DIRECTORY_USERS[1].id
  const annaRef = db.doc(`users/${anna}`)
  const brunoRef = db.doc(`users/${bruno}`)

  // ── Machines ──
  await db.collection("machine").doc(MACHINE_LASER_ID).set({
    name: "Lasercutter",
    workshop: "holz",
    requiredPermission: [db.doc(`permission/${SEEDED_PERMISSION_ID}`)],
    maco: null,
  })
  await db
    .collection("machine")
    .doc(MACHINE_CNC_ID)
    .set({
      name: "CNC Fräse",
      workshop: "metall",
      requiredPermission: [db.doc(`permission/${GRANTABLE_PERMISSION_ID}`)],
      maco: null,
      blocked: {
        kind: "problem",
        note: "Spindel macht Geräusche, bis Techniker geprüft hat nicht benutzen.",
        byName: "Admin Tester",
        at: ts("2026-06-28T10:00:00Z"),
      },
    })

  // ── Machine report (open Meldung on the Lasercutter) ──
  await db.collection("machine_reports").doc("e2e-report-1").set({
    machine: db.doc(`machine/${MACHINE_LASER_ID}`),
    message: OPEN_REPORT_MESSAGE,
    userId: annaRef,
    reporterName: null,
    created: ts("2026-06-28T09:00:00Z"),
    status: "open",
    resolvedAt: null,
  })

  // ── Membership: family, Anna owner + Bruno. Fixed far-future validity
  // so it never flips to "läuft ab" and screenshots stay stable. The
  // activeMembership denorm is written here directly (the trigger would
  // set it too, but asynchronously). ──
  await db.collection("memberships").doc(MEMBERSHIP_ID).set({
    type: "family",
    status: "active",
    lastPaidAt: ts("2026-05-21T08:00:00Z"),
    validUntil: ts("2030-05-21T00:00:00Z"),
    ownerUserId: annaRef,
    members: [annaRef, brunoRef],
    paymentCheckouts: [],
    autoRenew: true,
    created: ts("2026-05-21T08:00:00Z"),
  })
  await annaRef.set(
    { activeMembership: db.doc(`memberships/${MEMBERSHIP_ID}`) },
    { merge: true },
  )
  await brunoRef.set(
    { activeMembership: db.doc(`memberships/${MEMBERSHIP_ID}`) },
    { merge: true },
  )

  // ── Visits. The closed one carries billRef up front so the
  // onCheckoutCreatedClosed trigger doesn't allocate a competing bill. ──
  const closedVisitRef = db.collection("checkouts").doc(VISIT_CLOSED_ID)
  await closedVisitRef.set({
    userId: annaRef,
    status: "closed",
    usageType: "regular",
    created: ts("2026-06-28T14:05:00Z"),
    closedAt: ts("2026-06-28T16:10:00Z"),
    workshopsVisited: ["holz"],
    persons: [
      { name: "Anna Architektin", email: "anna@werkstattwaedi.ch", userType: "erwachsen" },
    ],
    billRef: db.doc(`bills/${BILL_OPEN_ID}`),
    summary: {
      totalPrice: 84,
      entryFees: 15,
      machineCost: 41,
      materialCost: 28,
      tip: 0,
    },
  })
  await closedVisitRef.collection("items").doc("item-laser").set({
    workshop: "holz",
    description: "Lasercutter Nutzung",
    origin: "nfc",
    type: "machine",
    catalogId: null,
    created: ts("2026-06-28T14:05:00Z"),
    quantity: 1.33,
    unitPrice: 30,
    totalPrice: 41,
  })
  await closedVisitRef.collection("items").doc("item-material").set({
    workshop: "holz",
    description: "Ahorn 30 mm",
    origin: "manual",
    catalogId: db.doc(`catalog/${CATALOG_AHORN_ID}`),
    created: ts("2026-06-28T14:40:00Z"),
    quantity: 0.5,
    unitPrice: 56,
    totalPrice: 28,
  })

  const openVisitRef = db.collection("checkouts").doc(VISIT_OPEN_ID)
  await openVisitRef.set({
    userId: annaRef,
    status: "open",
    usageType: "regular",
    created: ts("2026-07-01T14:20:00Z"),
    workshopsVisited: ["holz"],
    persons: [
      { name: "Anna Architektin", email: "anna@werkstattwaedi.ch", userType: "erwachsen" },
    ],
  })
  await openVisitRef.collection("items").doc("item-open-1").set({
    workshop: "holz",
    description: "Sperrholz 8 mm",
    origin: "qr",
    catalogId: null,
    created: ts("2026-07-01T14:25:00Z"),
    quantity: 1,
    unitPrice: 24,
    totalPrice: 24,
  })

  // ── Machine usage (Nutzungen) ──
  await db.collection("usage_machine").doc("e2e-usage-1").set({
    userId: annaRef,
    machine: db.doc(`machine/${MACHINE_LASER_ID}`),
    startTime: ts("2026-06-28T14:05:00Z"),
    endTime: ts("2026-06-28T15:25:00Z"),
    endReason: null,
    checkoutItemRef: closedVisitRef.collection("items").doc("item-laser"),
    workshop: "holz",
  })
  await db.collection("usage_machine").doc("e2e-usage-2").set({
    userId: brunoRef,
    machine: db.doc(`machine/${MACHINE_LASER_ID}`),
    startTime: ts("2026-06-24T19:30:00Z"),
    endTime: ts("2026-06-24T20:10:00Z"),
    endReason: null,
    checkoutItemRef: null,
    workshop: "holz",
  })

  // ── Bills. pdfGeneratedAt/emailSentAt are pre-set so the onBillCreate
  // side-effect chain (PDF render + email) treats them as done. The open
  // bill's `created` is relative to now — its status derives from
  // created+30d, and a fixed date would flip to überfällig once real time
  // passes it. ──
  const billBase = {
    userId: annaRef,
    currency: "CHF",
    storagePath: null,
    pdfGeneratedAt: ts("2026-06-28T16:15:00Z"),
    emailSentAt: ts("2026-06-28T16:15:00Z"),
  }
  await db
    .collection("bills")
    .doc(BILL_OPEN_ID)
    .set({
      ...billBase,
      checkouts: [closedVisitRef],
      referenceNumber: BILL_OPEN_REFERENCE,
      amount: 84,
      created: Timestamp.fromMillis(Date.now() - 5 * 24 * 60 * 60 * 1000),
      paidAt: null,
      paidVia: null,
    })
  await db
    .collection("bills")
    .doc(BILL_OVERDUE_ID)
    .set({
      ...billBase,
      checkouts: [],
      referenceNumber: BILL_OVERDUE_REFERENCE,
      amount: 40,
      created: ts("2026-01-15T10:00:00Z"),
      paidAt: null,
      paidVia: null,
    })
  await db
    .collection("bills")
    .doc(BILL_PAID_ID)
    .set({
      ...billBase,
      checkouts: [],
      referenceNumber: 2038,
      amount: 60,
      created: ts("2026-05-02T10:00:00Z"),
      paidAt: ts("2026-05-10T10:00:00Z"),
      paidVia: "twint",
    })

  // ── Catalog + price list. Eiche is modified AFTER the list's
  // generatedAt so the Preislisten tab shows a stable "veraltet". ──
  await db.collection("catalog").doc(CATALOG_AHORN_ID).set({
    code: "3001",
    name: "Ahorn 30 mm",
    labelName: "Ahorn",
    labelMass: "30 mm",
    workshops: ["holz"],
    category: ["Holz"],
    active: true,
    userCanAdd: true,
    variants: [
      { id: "default", pricingModel: "area", unitPrice: { default: 72 } },
    ],
    modifiedAt: ts("2026-05-01T10:00:00Z"),
  })
  await db.collection("catalog").doc(CATALOG_EICHE_ID).set({
    code: "3002",
    name: "Eiche 40 mm",
    workshops: ["holz"],
    category: ["Holz"],
    active: true,
    userCanAdd: true,
    variants: [
      { id: "default", pricingModel: "area", unitPrice: { default: 96 } },
    ],
    modifiedAt: ts("2026-06-15T10:00:00Z"),
  })
  await db
    .collection("price_lists")
    .doc(PRICE_LIST_ID)
    .set({
      name: "Holz — Aushang Werkstatt",
      items: [CATALOG_AHORN_ID, CATALOG_EICHE_ID],
      active: true,
      generatedAt: ts("2026-06-01T10:00:00Z"),
    })
}

async function clearEmulatorFirestore() {
  await fetch(
    `http://127.0.0.1:${E2E_PORTS.firestore}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  )
}

async function clearEmulatorAuth() {
  await fetch(
    `http://127.0.0.1:${E2E_PORTS.auth}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: "DELETE" },
  )
}

/** Create an Auth user with a known UID and a passwordless flow.
 *
 * The email-code login flow doesn't use a password (the user proves
 * possession of the email by reading the code from the emulator), so
 * we just need an Auth account that exists. We create it via the admin
 * SDK so we control the UID and can match it to the Firestore doc. */
async function createAuthUser(email: string, uid: string): Promise<string> {
  const auth = getAdminAuth()
  // If a previous run left this email behind, reuse it; otherwise create.
  try {
    const existing = await auth.getUserByEmail(email)
    return existing.uid
  } catch {
    // Not found — fall through to create.
  }
  const created = await auth.createUser({
    uid,
    email,
    emailVerified: true,
  })
  return created.uid
}
