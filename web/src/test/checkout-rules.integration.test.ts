// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Security rules tests for checkout create and item subcollection operations.
 *
 * Run with: npm run test:web:integration (from repo root)
 */

import { describe, it, beforeAll, afterAll, afterEach } from "vitest"
import {
  setupEmulator,
  clearFirestore,
  teardownEmulator,
  getTestEnvironment,
} from "./emulator-helper"
import {
  collection,
  addDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore"
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

/** Get a client-SDK Firestore for an authenticated user. */
function authedDb(uid: string) {
  return getTestEnvironment().authenticatedContext(uid).firestore()
}

/** Get a client-SDK Firestore for an unauthenticated user. */
function unauthDb() {
  return getTestEnvironment().unauthenticatedContext().firestore()
}

/** Create an open checkout for a user (uses rules-allowed create). */
async function createOpenCheckout(checkoutId: string, ownerUid: string) {
  const db = authedDb(ownerUid)
  await setDoc(doc(db, "checkouts", checkoutId), {
    userId: doc(db, "users", ownerUid),
    status: "open",
    usageType: "regular",
    created: serverTimestamp(),
    workshopsVisited: ["holz"],
    persons: [],
    modifiedBy: null,
    modifiedAt: serverTimestamp(),
  })
}

describe("Checkout create rules", () => {
  it("allows creating an open checkout", async () => {
    const db = authedDb("u1")
    await assertSucceeds(
      addDoc(collection(db, "checkouts"), {
        userId: doc(db, "users/u1"),
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: ["holz"],
        persons: [],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
      }),
    )
  })

  it("allows creating a closed checkout (one-shot anonymous submit)", async () => {
    const db = unauthDb()
    await assertSucceeds(
      addDoc(collection(db, "checkouts"), {
        userId: null,
        status: "closed",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: ["holz"],
        persons: [{ name: "Max", email: "max@test.com", userType: "erwachsen" }],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
        closedAt: serverTimestamp(),
        notes: null,
        summary: { totalPrice: 15, entryFees: 15, machineCost: 0, materialCost: 0, tip: 0 },
      }),
    )
  })

  it("allows authenticated user to create a closed checkout (no items added)", async () => {
    const db = authedDb("u1")
    await assertSucceeds(
      addDoc(collection(db, "checkouts"), {
        userId: doc(db, "users/u1"),
        status: "closed",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [{ name: "Max", email: "max@test.com", userType: "erwachsen" }],
        modifiedBy: "u1",
        modifiedAt: serverTimestamp(),
        closedAt: serverTimestamp(),
        notes: null,
        summary: { totalPrice: 15, entryFees: 15, machineCost: 0, materialCost: 0, tip: 0 },
      }),
    )
  })

  it("rejects checkout with invalid status", async () => {
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: doc(db, "users/u1"),
        status: "pending",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
      }),
    )
  })

  it("rejects checkout with disallowed fields", async () => {
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: doc(db, "users/u1"),
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
        extraField: "not allowed",
      }),
    )
  })
})

describe("Checkout items create rules", () => {
  it("allows owner to add items to their open checkout", async () => {
    // Create checkout as u1 (allowed by create rule)
    await createOpenCheckout("co1", "u1")

    const db = authedDb("u1")
    await assertSucceeds(
      addDoc(collection(db, "checkouts", "co1", "items"), {
        workshop: "holz",
        description: "Laser Stunde",
        origin: "manual",
        catalogId: null,
        created: serverTimestamp(),
        quantity: 1,
        unitPrice: 20,
        totalPrice: 20,
        formInputs: null,
      }),
    )
  })

  it("rejects items when user does not own the checkout", async () => {
    await createOpenCheckout("co1", "u1")

    const db = authedDb("u2") // different user
    await assertFails(
      addDoc(collection(db, "checkouts", "co1", "items"), {
        workshop: "holz",
        description: "Laser Stunde",
        origin: "manual",
        catalogId: null,
        created: serverTimestamp(),
        quantity: 1,
        unitPrice: 20,
        totalPrice: 20,
        formInputs: null,
      }),
    )
  })

  it("rejects items on a closed checkout", async () => {
    // Create a closed checkout via one-shot create
    const db = authedDb("u1")
    await setDoc(doc(db, "checkouts", "co1"), {
      userId: doc(db, "users/u1"),
      status: "closed",
      usageType: "regular",
      created: serverTimestamp(),
      workshopsVisited: [],
      persons: [],
      modifiedBy: null,
      modifiedAt: serverTimestamp(),
      closedAt: serverTimestamp(),
      notes: null,
      summary: { totalPrice: 0, entryFees: 0, machineCost: 0, materialCost: 0, tip: 0 },
    })

    await assertFails(
      addDoc(collection(db, "checkouts", "co1", "items"), {
        workshop: "holz",
        description: "Laser Stunde",
        origin: "manual",
        catalogId: null,
        created: serverTimestamp(),
        quantity: 1,
        unitPrice: 20,
        totalPrice: 20,
        formInputs: null,
      }),
    )
  })

  it("allows items on anonymous checkout (userId == null)", async () => {
    // Create anonymous open checkout via unauthenticated context
    const anonDb = unauthDb()
    await setDoc(doc(anonDb, "checkouts", "co-anon"), {
      userId: null,
      status: "open",
      usageType: "regular",
      created: serverTimestamp(),
      workshopsVisited: ["holz"],
      persons: [],
      modifiedBy: null,
      modifiedAt: serverTimestamp(),
    })

    // Unauthenticated users can add items to anonymous checkouts
    await assertSucceeds(
      addDoc(collection(anonDb, "checkouts", "co-anon", "items"), {
        workshop: "holz",
        description: "MDF Platte",
        origin: "qr",
        catalogId: null,
        created: serverTimestamp(),
        quantity: 1,
        unitPrice: 5,
        totalPrice: 5,
        formInputs: null,
      }),
    )
  })
})
