// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { initializeApp, getApps, type App } from "firebase-admin/app"
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore"

const PROJECT_ID = "oww-maco"

// E2E emulator ports — must match playwright.config.ts and firebase.e2e.json.
// `scripts/port-block.ts` exports EMULATOR_*_PORT when running under the
// broker; default to the firebase.e2e.json values otherwise.
export const E2E_PORTS = {
  auth: Number(process.env.EMULATOR_AUTH_PORT ?? 9199),
  firestore: Number(process.env.EMULATOR_FIRESTORE_PORT ?? 8180),
  functions: Number(process.env.EMULATOR_FUNCTIONS_PORT ?? 5101),
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

/** Query bill docs (most recent first) */
export async function getBillDocs() {
  const db = getAdminFirestore()
  const snap = await db.collection("bills").orderBy("created", "desc").get()
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

// ── Membership seeding (used by membership-screenshots.spec.ts) ─────────
//
// Stable IDs and dates so screenshot baselines are reproducible. The auth
// user from global-setup is reused; only the membership shape changes.

const MEMBERSHIP_ID = "e2e-membership-001"
const FAMILY_OWNER_OTHER_ID = "e2e-membership-other-owner-001"
const COMEMBER_ID_PREFIX = "e2e-membership-comember-"
const STABLE_VALID_UNTIL_ACTIVE = new Date("2027-05-12T12:00:00Z")
const STABLE_VALID_UNTIL_EXPIRED = new Date("2025-03-03T12:00:00Z")
const STABLE_VALID_UNTIL_CANCELLED = new Date("2026-07-11T12:00:00Z")
const STABLE_INVITE_DATE = new Date("2026-04-29T12:00:00Z")

export type SeedMembershipKind =
  | { kind: "none" }
  | { kind: "active-single" }
  | {
      kind: "active-family-owner"
      coMembers?: Array<{
        firstName: string
        lastName: string
        userType?: "erwachsen" | "kind"
      }>
      pendingInviteEmail?: string
    }
  | { kind: "active-family-member" }
  | { kind: "expired" }
  | { kind: "cancelled" }

/**
 * Re-shape the AUTH_USER's membership state for a single test. Cleans
 * `memberships` (and seeded co-member user docs) on every call so tests
 * are isolated. Caller passes the AUTH user's UID; the AUTH user doc is
 * preserved (its `activeMembership` field is updated in place).
 */
export async function seedMembershipState(
  authUserUid: string,
  kind: SeedMembershipKind,
): Promise<void> {
  const db = getAdminFirestore()

  // Wipe per-test state.
  await clearMembershipState(db, authUserUid)

  if (kind.kind === "none") {
    // `clearMembershipState` already deleted any prior membership doc; the
    // /membership page queries by `members array-contains` so the user-doc
    // `activeMembership` field is irrelevant for the rendering. We don't
    // touch it here — the onMembershipWritten trigger keeps it honest.
    return
  }

  const userRef = db.collection("users").doc(authUserUid)
  const membershipRef = db.collection("memberships").doc(MEMBERSHIP_ID)

  if (kind.kind === "active-single") {
    await membershipRef.set({
      type: "single",
      status: "active",
      lastPaidAt: Timestamp.fromDate(
        new Date(STABLE_VALID_UNTIL_ACTIVE.getTime() - 365 * 24 * 60 * 60 * 1000),
      ),
      validUntil: Timestamp.fromDate(STABLE_VALID_UNTIL_ACTIVE),
      ownerUserId: userRef,
      members: [userRef],
      paymentCheckouts: [],
      created: Timestamp.fromDate(STABLE_INVITE_DATE),
    })
    await userRef.set({ activeMembership: membershipRef }, { merge: true })
    return
  }

  if (kind.kind === "active-family-owner") {
    const memberRefs = [userRef]
    const co = kind.coMembers ?? []
    for (let i = 0; i < co.length; i++) {
      const m = co[i]
      const id = `${COMEMBER_ID_PREFIX}${i + 1}`
      const ref = db.collection("users").doc(id)
      await ref.set({
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.userType === "kind" ? null : `${m.firstName.toLowerCase()}.${m.lastName.toLowerCase()}@beispiel.ch`,
        roles: [],
        permissions: [],
        userType: m.userType ?? "erwachsen",
        activeMembership: membershipRef,
        created: Timestamp.fromDate(STABLE_INVITE_DATE),
      })
      memberRefs.push(ref)
    }
    await membershipRef.set({
      type: "family",
      status: "active",
      lastPaidAt: Timestamp.fromDate(
        new Date(STABLE_VALID_UNTIL_ACTIVE.getTime() - 365 * 24 * 60 * 60 * 1000),
      ),
      validUntil: Timestamp.fromDate(STABLE_VALID_UNTIL_ACTIVE),
      ownerUserId: userRef,
      members: memberRefs,
      paymentCheckouts: [],
      created: Timestamp.fromDate(STABLE_INVITE_DATE),
    })
    // Issue #209: the firestore rule `shareActiveMembership` lets co-members
    // read each other's user docs only when *both* sides have
    // `activeMembership` populated. The production `onMembershipWritten`
    // trigger keeps that field in sync; in the emulator we have to stamp
    // it explicitly. Without this the family-roster quick-add (and the
    // membership page's family roster) silently render empty.
    await userRef.set({ activeMembership: membershipRef }, { merge: true })

    if (kind.pendingInviteEmail) {
      // Seed `invitedAt` exactly 2 days before the real clock so the page's
      // relative-time rendering is a stable "vor 2 Tagen" without freezing the
      // browser clock (which would future-date the auth token and break the
      // invites listener). The 2-day delta rounds stably across a test run.
      const invitedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      await membershipRef.collection("invites").doc("e2e-invite-001").set({
        email: kind.pendingInviteEmail,
        status: "pending",
        invitedAt: Timestamp.fromDate(invitedAt),
        invitedBy: userRef,
        resolvedAt: null,
        ttlAt: Timestamp.fromDate(
          new Date(invitedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        ),
      })
    }
    return
  }

  if (kind.kind === "active-family-member") {
    const ownerRef = db.collection("users").doc(FAMILY_OWNER_OTHER_ID)
    await ownerRef.set({
      firstName: "Anna",
      lastName: "Müller",
      email: "anna.mueller@beispiel.ch",
      roles: [],
      permissions: [],
      userType: "erwachsen",
      activeMembership: membershipRef,
      created: Timestamp.fromDate(STABLE_INVITE_DATE),
    })
    await membershipRef.set({
      type: "family",
      status: "active",
      lastPaidAt: Timestamp.fromDate(
        new Date(STABLE_VALID_UNTIL_ACTIVE.getTime() - 365 * 24 * 60 * 60 * 1000),
      ),
      validUntil: Timestamp.fromDate(STABLE_VALID_UNTIL_ACTIVE),
      ownerUserId: ownerRef,
      members: [ownerRef, userRef],
      paymentCheckouts: [],
      created: Timestamp.fromDate(STABLE_INVITE_DATE),
    })
    await userRef.set({ activeMembership: membershipRef }, { merge: true })
    return
  }

  if (kind.kind === "expired") {
    await membershipRef.set({
      type: "single",
      status: "expired",
      lastPaidAt: Timestamp.fromDate(
        new Date(STABLE_VALID_UNTIL_EXPIRED.getTime() - 365 * 24 * 60 * 60 * 1000),
      ),
      validUntil: Timestamp.fromDate(STABLE_VALID_UNTIL_EXPIRED),
      ownerUserId: userRef,
      members: [userRef],
      paymentCheckouts: [],
      created: Timestamp.fromDate(STABLE_INVITE_DATE),
    })
    return
  }

  if (kind.kind === "cancelled") {
    await membershipRef.set({
      type: "single",
      status: "cancelled",
      lastPaidAt: Timestamp.fromDate(
        new Date(STABLE_VALID_UNTIL_CANCELLED.getTime() - 365 * 24 * 60 * 60 * 1000),
      ),
      validUntil: Timestamp.fromDate(STABLE_VALID_UNTIL_CANCELLED),
      ownerUserId: userRef,
      members: [userRef],
      paymentCheckouts: [],
      created: Timestamp.fromDate(STABLE_INVITE_DATE),
    })
    return
  }
}

async function clearMembershipState(
  db: Firestore,
  authUserUid: string,
): Promise<void> {
  // Recursive delete on all memberships (incl. invites sub-collection).
  const memberships = await db.collection("memberships").get()
  for (const m of memberships.docs) {
    const invites = await m.ref.collection("invites").get()
    const batch = db.batch()
    invites.docs.forEach((d) => batch.delete(d.ref))
    batch.delete(m.ref)
    await batch.commit()
  }

  // Wipe seeded co-member docs but keep AUTH_USER.
  const seededIds = [FAMILY_OWNER_OTHER_ID]
  for (let i = 1; i <= 10; i++) seededIds.push(`${COMEMBER_ID_PREFIX}${i}`)
  for (const id of seededIds) {
    if (id === authUserUid) continue
    await db.collection("users").doc(id).delete().catch(() => undefined)
  }

  // Clear the activeMembership stamp on the AUTH user (set by the
  // `active-family-owner` branch — issue #209). Without this, a
  // subsequent `none` / `active-single` seed leaves the auth user
  // pointing at a deleted membership doc.
  await db
    .collection("users")
    .doc(authUserUid)
    .set({ activeMembership: null }, { merge: true })
    .catch(() => undefined)
}

// ── Usage / bills seeding (used by usage-screenshots.spec.ts) ───────────
//
// Stable IDs and dates so the screenshot baselines stay reproducible.

const USAGE_BILL_PAID_ID = "e2e-bill-paid-001"
const USAGE_BILL_OPEN_ID = "e2e-bill-open-001"
const USAGE_BILL_PAID_CREATED = new Date("2026-02-14T10:30:00Z")
const USAGE_BILL_PAID_PAID_AT = new Date("2026-02-20T08:15:00Z")
const USAGE_BILL_OPEN_CREATED = new Date("2026-04-04T15:45:00Z")

/**
 * Seed two `bills` rows for the auth user so the /usage Rechnungen tab
 * has stable, reproducible content for screenshot regression tests.
 *
 * Both bills carry a `storagePath`, so the download icon renders on
 * each row — that's the affordance issue #215 was about.
 */
export async function seedUsageBills(authUserUid: string): Promise<void> {
  const db = getAdminFirestore()
  await clearCollections("bills")
  const userRef = db.collection("users").doc(authUserUid)

  await db.collection("bills").doc(USAGE_BILL_PAID_ID).set({
    userId: userRef,
    checkouts: [],
    referenceNumber: 240001,
    amount: 42.5,
    currency: "CHF",
    storagePath: "bills/e2e-bill-paid-001.pdf",
    created: Timestamp.fromDate(USAGE_BILL_PAID_CREATED),
    paidAt: Timestamp.fromDate(USAGE_BILL_PAID_PAID_AT),
    paidVia: "twint",
  })

  await db.collection("bills").doc(USAGE_BILL_OPEN_ID).set({
    userId: userRef,
    checkouts: [],
    referenceNumber: 240002,
    amount: 18,
    currency: "CHF",
    storagePath: "bills/e2e-bill-open-001.pdf",
    created: Timestamp.fromDate(USAGE_BILL_OPEN_CREATED),
    paidAt: null,
    paidVia: null,
  })
}

// ── Open-checkout seeding (used by checkout-screenshots.spec.ts) ────────
//
// Issue #262/#263: seed an open checkout carrying a Vereinsmitgliedschaft
// SKU so the summary + workshops step can be screenshotted. The membership
// catalog is `catalog/e2e-membership` (see global-setup.ts), variant
// `single`. Stable id so the baseline stays reproducible.

const E2E_OPEN_CHECKOUT_ID = "e2e-open-checkout-001"

/**
 * Replace the auth user's open checkout with one that contains a membership
 * item, and optionally a regular workshop material item (mixed cart). The
 * checkout is created the same way the membership-purchase callable does:
 * `usageType: "materialbezug"` for a membership-only cart, `regular` when a
 * workshop item is present. `firebaseUid` / `modifiedBy` are stamped with the
 * auth UID so the wizard's open-checkout subscription (scoped by `userId`)
 * picks it up for a signed-in user.
 */
/**
 * Recursively delete every `checkouts` doc AND its `items` subcollection.
 * `clearCollections` deletes only the parent docs — Firestore keeps
 * subcollection docs alive under a deleted parent — so re-seeding the same
 * fixed-id checkout would otherwise accumulate orphaned items across tests
 * (the membership count would climb 1→2→3…). Use this whenever a test seeds
 * or leaves behind a checkout with items.
 */
export async function clearCheckoutsDeep(): Promise<void> {
  const db = getAdminFirestore()
  const existing = await db.collection("checkouts").get()
  for (const doc of existing.docs) {
    const items = await doc.ref.collection("items").get()
    const batch = db.batch()
    items.docs.forEach((d) => batch.delete(d.ref))
    batch.delete(doc.ref)
    await batch.commit()
  }
}

export async function seedOpenCheckoutWithMembership(
  authUserUid: string,
  { withWorkshopItem = false }: { withWorkshopItem?: boolean } = {},
): Promise<void> {
  const db = getAdminFirestore()
  await clearCheckoutsDeep()
  const userRef = db.collection("users").doc(authUserUid)
  const membershipCatalog = db.doc("catalog/e2e-membership")
  const now = Timestamp.now()

  const checkoutRef = db.collection("checkouts").doc(E2E_OPEN_CHECKOUT_ID)
  // Defensive: clear orphaned items left under this fixed-id path even when the
  // parent doc was shallow-deleted elsewhere. Other specs call the shallow
  // `clearCollections("checkouts")`, which deletes the parent doc but leaves its
  // `items` subcollection orphaned — `clearCheckoutsDeep` only sees items whose
  // parent doc still exists, so it can't reach those. Re-`.set()`-ing the same
  // fixed id below would re-attach the orphans, making the membership/material
  // counts climb across runs (1→2→3…). Sweep them explicitly first.
  const stale = await checkoutRef.collection("items").get()
  if (!stale.empty) {
    const batch = db.batch()
    stale.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  await checkoutRef.set({
    userId: userRef,
    status: "open",
    usageType: withWorkshopItem ? "regular" : "materialbezug",
    created: now,
    // Mirror production: `purchaseMembership` creates the open checkout with
    // an empty `workshopsVisited` (the membership SKU lives in `diverses` but
    // is classified out of the workshop sections). A genuine membership-only
    // cart therefore has no visited workshop, so the issue-#362 gate keeps the
    // picker hidden. The mixed case adds the real `holz` workshop the item
    // belongs to.
    workshopsVisited: withWorkshopItem ? ["holz"] : [],
    persons: [
      {
        name: "E2E Testuser",
        email: "e2e-test@werkstattwaedi.ch",
        userType: "erwachsen",
        userRef,
      },
    ],
    modifiedBy: authUserUid,
    modifiedAt: now,
    firebaseUid: authUserUid,
  })

  await checkoutRef.collection("items").add({
    workshop: "diverses",
    description: "Mitgliedschaft — Einzel",
    origin: "manual",
    catalogId: membershipCatalog,
    variantId: "single",
    pricingModel: "direct",
    created: now,
    quantity: 1,
    unitPrice: 80,
    totalPrice: 80,
  })

  if (withWorkshopItem) {
    await checkoutRef.collection("items").add({
      workshop: "holz",
      description: "Schleifpapier",
      origin: "manual",
      catalogId: null,
      pricingModel: "count",
      created: now,
      quantity: 3,
      unitPrice: 2,
      totalPrice: 6,
    })
  }
}

const INVITE_OWNER_ID = "e2e-invite-owner-001"
const INVITE_MEMBERSHIP_ID = "e2e-invite-membership-001"
const INVITE_ID = "e2e-invite-doc-001"

/**
 * Seed a family membership owned by *another* user plus a pending invite for
 * `inviteeEmail`. Used by the invite-acceptance (receiving end) specs, where
 * the invitee is a different principal than the seeded AUTH user. When
 * `inviteeHasAccount` is set, a completed user doc is seeded for the email so
 * the page takes the "log in to accept" branch. Returns the link path params.
 */
export async function seedFamilyInvite(
  inviteeEmail: string,
  { inviteeHasAccount = false }: { inviteeHasAccount?: boolean } = {},
): Promise<{ membershipId: string; inviteId: string }> {
  const db = getAdminFirestore()
  const ownerRef = db.collection("users").doc(INVITE_OWNER_ID)
  const memRef = db.collection("memberships").doc(INVITE_MEMBERSHIP_ID)

  await ownerRef.set({
    firstName: "Owner",
    lastName: "Family",
    email: "invite-owner@beispiel.ch",
    roles: [],
    permissions: [],
    userType: "erwachsen",
    termsAcceptedAt: Timestamp.fromDate(STABLE_INVITE_DATE),
    activeMembership: memRef,
    created: Timestamp.fromDate(STABLE_INVITE_DATE),
  })
  await memRef.set({
    type: "family",
    status: "active",
    lastPaidAt: Timestamp.fromDate(
      new Date(STABLE_VALID_UNTIL_ACTIVE.getTime() - 365 * 24 * 60 * 60 * 1000),
    ),
    validUntil: Timestamp.fromDate(STABLE_VALID_UNTIL_ACTIVE),
    ownerUserId: ownerRef,
    members: [ownerRef],
    paymentCheckouts: [],
    created: Timestamp.fromDate(STABLE_INVITE_DATE),
  })

  if (inviteeHasAccount) {
    await db.collection("users").doc("e2e-invite-existing-001").set({
      firstName: "Bestehend",
      lastName: "Konto",
      email: inviteeEmail.toLowerCase(),
      roles: [],
      permissions: [],
      userType: "erwachsen",
      termsAcceptedAt: Timestamp.fromDate(STABLE_INVITE_DATE),
      created: Timestamp.fromDate(STABLE_INVITE_DATE),
    })
  }

  await memRef.collection("invites").doc(INVITE_ID).set({
    email: inviteeEmail.toLowerCase(),
    status: "pending",
    invitedAt: Timestamp.fromDate(STABLE_INVITE_DATE),
    invitedBy: ownerRef,
    resolvedAt: null,
    ttlAt: Timestamp.fromDate(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ),
  })

  return { membershipId: INVITE_MEMBERSHIP_ID, inviteId: INVITE_ID }
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
 * The check-in redesign (kiosk sign-in flow handoff) hides the guest form
 * behind the "Als Gast" segment while the visitor is anonymous — the
 * account section is the default on a fresh load. Open the guest section
 * before filling person fields. Safe to call when the guest section is
 * already active (rehydrated roster): clicking the active segment is a
 * no-op.
 */
export async function openGuestSection(page: import("@playwright/test").Page) {
  const guestSeg = page.getByTestId("checkin-seg-guest")
  await guestSeg.waitFor({ state: "visible", timeout: 10_000 })
  await guestSeg.click()
}

/**
 * Admin Auth handle against the emulator (same app as getAdminFirestore —
 * calling that first wires the emulator env hosts).
 */
export async function getAdminAuth() {
  getAdminFirestore()
  const { getAuth } = await import("firebase-admin/auth")
  return getAuth()
}

/**
 * Fetch the most recent phone-auth verification code the Auth emulator
 * "sent" to `phone` (E.164). The emulator never sends real SMS; codes are
 * exposed on its REST surface for tests (SMS login, ADR-0031).
 */
export async function waitForSmsCode(
  phone: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  const url = `http://127.0.0.1:${E2E_PORTS.auth}/emulator/v1/projects/${PROJECT_ID}/verificationCodes`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(url)
    if (res.ok) {
      const body = (await res.json()) as {
        verificationCodes?: { phoneNumber: string; code: string }[]
      }
      const entries = (body.verificationCodes ?? []).filter(
        (c) => c.phoneNumber === phone,
      )
      if (entries.length > 0) return entries[entries.length - 1].code
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}
