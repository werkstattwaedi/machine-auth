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

import { FieldValue } from "firebase-admin/firestore"
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

export default async function globalSetup() {
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
  const adminUid = await createAuthUser(ADMIN_EMAIL)
  const memberUid = await createAuthUser(NON_ADMIN_EMAIL)

  // ── Firestore user docs ──
  // Admin user — receives the `admin` role; syncCustomClaims will set the
  // matching custom claim asynchronously, which we wait for below.
  await db
    .collection("users")
    .doc(adminUid)
    .set({
      displayName: "Admin Tester",
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
      displayName: "Member Tester",
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
        displayName: `${u.firstName} ${u.lastName}`,
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
async function createAuthUser(email: string): Promise<string> {
  const auth = getAdminAuth()
  // If a previous run left this email behind, reuse it; otherwise create.
  try {
    const existing = await auth.getUserByEmail(email)
    return existing.uid
  } catch {
    // Not found — fall through to create.
  }
  const created = await auth.createUser({
    email,
    emailVerified: true,
  })
  return created.uid
}
