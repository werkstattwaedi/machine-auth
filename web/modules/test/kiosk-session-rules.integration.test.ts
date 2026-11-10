// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * What a kiosk session may read of its own member (#854, ADR-0041).
 *
 * A badge tap alone yields an un-elevated `actsAs` session: it reads only
 * the visit at hand — the open checkout (or one awaiting payment), the ones
 * closed in the last two days (same-day fee, terminal watcher), their items,
 * the machine time linked to them, and the saved persons of the check-in.
 * Everything else of the member — the users doc, older checkouts, bills,
 * memberships, unlinked or old usage — needs the step-up, after which the
 * same session reads it like the member's own login. Cross-user leaks are
 * covered by cross-user-rules.integration.test.ts.
 *
 * Run with: npm run test:web:integration (from repo root)
 */

import { describe, it, beforeAll, afterAll, afterEach } from "vitest"
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getTestEnvironment,
  getAdminFirestore,
} from "./emulator-helper"
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  Timestamp as ClientTimestamp,
} from "firebase/firestore"
import { Timestamp } from "firebase-admin/firestore"
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing"

beforeAll(async () => {
  await setupEmulator()
})

afterEach(async () => {
  await clearFirestore()
})

afterAll(async () => {
  await teardownEmulator()
})

const OWNER = "alice"
const DAY_MS = 24 * 60 * 60 * 1000

/** A badge tap alone: no `elevatedUntil`. */
function badgeDb() {
  return getTestEnvironment()
    .authenticatedContext(`tag:${OWNER}:s1`, {
      actsAs: OWNER,
      tagCheckout: true,
    })
    .firestore()
}

/** The same session after the step-up (or a code sign-in). */
function elevatedDb() {
  return getTestEnvironment()
    .authenticatedContext(`tag:${OWNER}:s1`, {
      actsAs: OWNER,
      tagCheckout: true,
      elevatedUntil: Date.now() + 15 * 60_000,
    })
    .firestore()
}

function ownerRef() {
  return getAdminFirestore().doc(`users/${OWNER}`)
}

async function seedUser() {
  await getAdminFirestore().collection("users").doc(OWNER).set({
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Muster",
    phone: "+41791234567",
    roles: [],
    permissions: {},
    termsAcceptedAt: Timestamp.now(),
    activeMembership: getAdminFirestore().doc("memberships/m1"),
  })
}

async function seedCheckout(
  id: string,
  status: "open" | "awaiting_payment" | "closed",
  closedAgoMs?: number,
) {
  const db = getAdminFirestore()
  await db
    .collection("checkouts")
    .doc(id)
    .set({
      userId: ownerRef(),
      status,
      usageType: "regular",
      created: Timestamp.fromMillis(Date.now() - (closedAgoMs ?? 0) - 3600_000),
      workshopsVisited: [],
      persons: [],
      ...(status === "closed"
        ? { closedAt: Timestamp.fromMillis(Date.now() - (closedAgoMs ?? 0)) }
        : {}),
    })
  await db.collection("checkouts").doc(id).collection("items").doc("i1").set({
    workshop: "holz",
    description: "Maschine",
    origin: "nfc",
    catalogId: null,
    created: Timestamp.now(),
    quantity: 1,
    unitPrice: 20,
    totalPrice: 20,
  })
}

async function seedUsage(id: string, checkoutId: string | null) {
  const db = getAdminFirestore()
  await db
    .collection("usage_machine")
    .doc(id)
    .set({
      userId: ownerRef(),
      machine: db.doc("machine/m1"),
      startTime: Timestamp.now(),
      endTime: Timestamp.now(),
      checkoutItemRef: checkoutId
        ? db.doc(`checkouts/${checkoutId}/items/i1`)
        : null,
      workshop: "holz",
    })
}

describe("kiosk badge session: the visit at hand", () => {
  it("reads the open checkout through the kiosk's own query, and its items", async () => {
    await seedCheckout("co-open", "open")
    const db = badgeDb()
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "checkouts"),
          where("userId", "==", doc(db, `users/${OWNER}`)),
          where("status", "==", "open"),
        ),
      ),
    )
    await assertSucceeds(getDoc(doc(db, "checkouts/co-open")))
    await assertSucceeds(getDocs(collection(db, "checkouts/co-open/items")))
  })

  it("reads a checkout awaiting payment (query and by id)", async () => {
    await seedCheckout("co-await", "awaiting_payment")
    const db = badgeDb()
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "checkouts"),
          where("userId", "==", doc(db, `users/${OWNER}`)),
          where("status", "==", "awaiting_payment"),
        ),
      ),
    )
    await assertSucceeds(getDoc(doc(db, "checkouts/co-await")))
  })

  it("reads checkouts closed today through a query bounded inside the window", async () => {
    await seedCheckout("co-today", "closed", 2 * 3600_000)
    const db = badgeDb()
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "checkouts"),
          where("userId", "==", doc(db, `users/${OWNER}`)),
          where("status", "==", "closed"),
          where(
            "closedAt",
            ">=",
            ClientTimestamp.fromMillis(Date.now() - 36 * 3600_000),
          ),
        ),
      ),
    )
    await assertSucceeds(getDoc(doc(db, "checkouts/co-today")))
  })

  it("reads the machine time linked to the open checkout", async () => {
    await seedCheckout("co-open", "open")
    await seedUsage("u-open", "co-open")
    const db = badgeDb()
    await assertSucceeds(getDoc(doc(db, "usage_machine/u-open")))
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "usage_machine"),
          where("userId", "==", doc(db, `users/${OWNER}`)),
          where("checkoutItemRef", "==", doc(db, "checkouts/co-open/items/i1")),
        ),
      ),
    )
  })

  it("reads the saved persons of the check-in", async () => {
    await getAdminFirestore()
      .collection(`users/${OWNER}/savedPersons`)
      .doc("p1")
      .set({ firstName: "Bob", lastName: "Muster", userType: "kind" })
    await assertSucceeds(
      getDocs(collection(badgeDb(), `users/${OWNER}/savedPersons`)),
    )
  })
})

describe("kiosk badge session: everything else needs the step-up", () => {
  it("users doc", async () => {
    await seedUser()
    await assertFails(getDoc(doc(badgeDb(), `users/${OWNER}`)))
    await assertSucceeds(getDoc(doc(elevatedDb(), `users/${OWNER}`)))
  })

  it("a checkout closed before the window, by id, with its items", async () => {
    await seedCheckout("co-old", "closed", 5 * DAY_MS)
    await assertFails(getDoc(doc(badgeDb(), "checkouts/co-old")))
    await assertFails(getDocs(collection(badgeDb(), "checkouts/co-old/items")))
    await assertSucceeds(getDoc(doc(elevatedDb(), "checkouts/co-old")))
    await assertSucceeds(
      getDocs(collection(elevatedDb(), "checkouts/co-old/items")),
    )
  })

  it("the checkout history: every query not bound to the visit at hand", async () => {
    await seedCheckout("co-old", "closed", 5 * DAY_MS)
    const history = (db: ReturnType<typeof badgeDb>) =>
      getDocs(
        query(
          collection(db, "checkouts"),
          where("userId", "==", doc(db, `users/${OWNER}`)),
          where("status", "==", "closed"),
        ),
      )
    await assertFails(history(badgeDb()))
    await assertSucceeds(history(elevatedDb()))
    // A range reaching back before the window is refused as a whole.
    await assertFails(
      getDocs(
        query(
          collection(badgeDb(), "checkouts"),
          where("userId", "==", doc(badgeDb(), `users/${OWNER}`)),
          where("status", "==", "closed"),
          where(
            "closedAt",
            ">=",
            ClientTimestamp.fromMillis(Date.now() - 7 * DAY_MS),
          ),
        ),
      ),
    )
  })

  it("machine time not on the visit at hand", async () => {
    await seedCheckout("co-old", "closed", 5 * DAY_MS)
    await seedUsage("u-old", "co-old")
    await seedUsage("u-unlinked", null)
    for (const id of ["u-old", "u-unlinked"]) {
      await assertFails(getDoc(doc(badgeDb(), `usage_machine/${id}`)))
      await assertSucceeds(getDoc(doc(elevatedDb(), `usage_machine/${id}`)))
    }
    const all = (db: ReturnType<typeof badgeDb>) =>
      getDocs(
        query(
          collection(db, "usage_machine"),
          where("userId", "==", doc(db, `users/${OWNER}`)),
        ),
      )
    await assertFails(all(badgeDb()))
    await assertSucceeds(all(elevatedDb()))
  })

  it("bills", async () => {
    await getAdminFirestore().collection("bills").doc("b1").set({
      userId: ownerRef(),
      checkouts: [],
      referenceNumber: 42000010,
      amount: 42,
      currency: "CHF",
      created: Timestamp.now(),
      paidAt: null,
    })
    await assertFails(getDoc(doc(badgeDb(), "bills/b1")))
    await assertSucceeds(getDoc(doc(elevatedDb(), "bills/b1")))
  })

  it("the membership and the family members' users docs", async () => {
    const db = getAdminFirestore()
    await seedUser()
    await db.collection("users").doc("bob").set({
      email: "bob@example.com",
      firstName: "Bob",
      lastName: "Muster",
      roles: [],
      permissions: {},
      activeMembership: db.doc("memberships/m1"),
    })
    await db
      .collection("memberships")
      .doc("m1")
      .set({
        ownerUserId: ownerRef(),
        members: [ownerRef(), db.doc("users/bob")],
        type: "family",
      })
    await assertFails(getDoc(doc(badgeDb(), "memberships/m1")))
    await assertFails(getDoc(doc(badgeDb(), "users/bob")))
    await assertSucceeds(getDoc(doc(elevatedDb(), "memberships/m1")))
    await assertSucceeds(getDoc(doc(elevatedDb(), "users/bob")))
  })
})
