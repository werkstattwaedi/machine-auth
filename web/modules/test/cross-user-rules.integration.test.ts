// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Cross-user Firestore security rules tests.
 *
 * Regression net for the B2 launch-readiness incident (cross-user
 * `checkouts` read leak): for every owner-scoped collection, asserts
 * that User B cannot read or write User A's data, anonymous principals
 * are denied, and the intentional admin / tag-tap carve-outs still work.
 *
 * If you add a new owner-scoped collection, add a `describe` block here.
 * Each negative case is paired with the matching positive carve-out so
 * the intent is documented in the same place as the test.
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
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore"
import { FieldValue } from "firebase-admin/firestore"
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

// --- Principal helpers ----------------------------------------------------

/** Real signed-in user (uid == users/{uid}). */
function authedDb(uid: string) {
  return getTestEnvironment().authenticatedContext(uid).firestore()
}

/**
 * Kiosk tag-tap session: synthetic UID with `actsAs` claim naming the
 * real user. Mirrors the custom token verifyTagCheckout mints.
 */
function tagSessionDb(realUserUid: string, sessionUid?: string) {
  const sid = sessionUid ?? `tag:${realUserUid}:s1`
  return getTestEnvironment()
    .authenticatedContext(sid, { actsAs: realUserUid, tagCheckout: true })
    .firestore()
}

/** Firebase Anonymous Auth session — used by truly-anonymous checkout. */
function anonAuthDb(uid: string) {
  return getTestEnvironment()
    .authenticatedContext(uid, {
      firebase: { sign_in_provider: "anonymous", identities: {} },
    })
    .firestore()
}

/** Unauthenticated client. */
function unauthDb() {
  return getTestEnvironment().unauthenticatedContext().firestore()
}

/** Admin (admin custom claim, set by syncCustomClaims in production). */
function adminDb() {
  return getTestEnvironment()
    .authenticatedContext("admin-test", { admin: true })
    .firestore()
}

/**
 * assertFails wrapper that prefixes a human-readable scenario label and
 * a rule reference so a regression in CI output points straight at the
 * source line that loosened.
 */
async function assertCrossUserDenied(
  scenario: string,
  ruleRef: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await assertFails(fn())
  } catch (err) {
    throw new Error(
      `${scenario} (expected denial — see ${ruleRef}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

// --- Seeders (admin SDK, bypasses rules) ---------------------------------

async function seedUser(uid: string, overrides: Record<string, unknown> = {}) {
  const db = getAdminFirestore()
  await db
    .collection("users")
    .doc(uid)
    .set({
      displayName: `User ${uid}`,
      name: `User ${uid}`,
      email: `${uid}@test.com`,
      roles: ["vereinsmitglied"],
      permissions: [],
      userType: "erwachsen",
      ...overrides,
    })
}

async function seedOpenCheckout(checkoutId: string, ownerUid: string) {
  const db = getAdminFirestore()
  await db
    .collection("checkouts")
    .doc(checkoutId)
    .set({
      userId: db.doc(`users/${ownerUid}`),
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      workshopsVisited: ["holz"],
      persons: [],
      modifiedBy: null,
      modifiedAt: FieldValue.serverTimestamp(),
    })
}

async function seedAnonCheckout(checkoutId: string) {
  const db = getAdminFirestore()
  await db
    .collection("checkouts")
    .doc(checkoutId)
    .set({
      userId: null,
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      workshopsVisited: ["holz"],
      persons: [],
      modifiedBy: null,
      modifiedAt: FieldValue.serverTimestamp(),
    })
}

async function seedCheckoutItem(
  checkoutId: string,
  itemId: string,
) {
  const db = getAdminFirestore()
  await db
    .collection("checkouts")
    .doc(checkoutId)
    .collection("items")
    .doc(itemId)
    .set({
      workshop: "holz",
      description: "Laser Stunde",
      origin: "manual",
      catalogId: null,
      created: FieldValue.serverTimestamp(),
      quantity: 1,
      unitPrice: 20,
      totalPrice: 20,
      formInputs: null,
    })
}

async function seedBill(billId: string, ownerUid: string) {
  const db = getAdminFirestore()
  await db
    .collection("bills")
    .doc(billId)
    .set({
      userId: db.doc(`users/${ownerUid}`),
      checkouts: [],
      referenceNumber: 1,
      amount: 42,
      currency: "CHF",
      storagePath: null,
      created: FieldValue.serverTimestamp(),
      paidAt: null,
    })
}

async function seedUsageMachine(usageId: string, ownerUid: string) {
  const db = getAdminFirestore()
  await db
    .collection("usage_machine")
    .doc(usageId)
    .set({
      userId: db.doc(`users/${ownerUid}`),
      authenticationId: null,
      machine: db.doc("machine/m1"),
      startTime: FieldValue.serverTimestamp(),
      endTime: FieldValue.serverTimestamp(),
      endReason: null,
      checkoutItemRef: null,
      workshop: "holz",
    })
}

async function seedToken(tokenId: string, ownerUid: string) {
  const db = getAdminFirestore()
  await db
    .collection("tokens")
    .doc(tokenId)
    .set({
      userId: db.doc(`users/${ownerUid}`),
      registeredAt: FieldValue.serverTimestamp(),
    })
}

// --- Tests ---------------------------------------------------------------

describe("cross-user: users", () => {
  it("denies bob reading alice's user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} read leaked to non-owner",
      "firestore.rules:82-84",
      () => getDoc(doc(authedDb("bob"), "users", "alice")),
    )
  })

  it("denies bob updating alice's user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} update leaked to non-owner",
      "firestore.rules:95-100",
      () =>
        updateDoc(doc(authedDb("bob"), "users", "alice"), {
          displayName: "pwned",
        }),
    )
  })

  it("denies bob deleting alice's user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} delete leaked to non-owner",
      "firestore.rules:102",
      () => deleteDoc(doc(authedDb("bob"), "users", "alice")),
    )
  })

  it("denies tag-tap-as-bob reading alice's user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} read leaked across tag-tap actsAs",
      "firestore.rules:82-84",
      () => getDoc(doc(tagSessionDb("bob"), "users", "alice")),
    )
  })

  it("denies tag-tap-as-bob updating alice's user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} update leaked across tag-tap actsAs",
      "firestore.rules:95-100",
      () =>
        updateDoc(doc(tagSessionDb("bob"), "users", "alice"), {
          displayName: "pwned",
        }),
    )
  })

  it("denies anonymous-auth reading any user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} read leaked to anonymous-auth session",
      "firestore.rules:82-84",
      () => getDoc(doc(anonAuthDb("anon-x"), "users", "alice")),
    )
  })

  it("denies fully unauthenticated reading any user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} read leaked to unauthenticated session",
      "firestore.rules:82-84",
      () => getDoc(doc(unauthDb(), "users", "alice")),
    )
  })

  // Positive carve-outs (intentional access paths — fail loudly if removed)
  it("allows alice reading her own user doc", async () => {
    await seedUser("alice")
    await assertSucceeds(getDoc(doc(authedDb("alice"), "users", "alice")))
  })

  it("allows tag-tap-as-alice reading alice's user doc (kiosk pre-fill)", async () => {
    await seedUser("alice")
    await assertSucceeds(getDoc(doc(tagSessionDb("alice"), "users", "alice")))
  })

  it("allows admin reading any user doc", async () => {
    await seedUser("alice")
    await assertSucceeds(getDoc(doc(adminDb(), "users", "alice")))
  })
})

describe("cross-user: checkouts", () => {
  it("denies bob reading alice's checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id} read leaked to non-owner (B2 incident)",
      "firestore.rules:158-160",
      () => getDoc(doc(authedDb("bob"), "checkouts", "co1")),
    )
  })

  it("denies bob updating alice's open checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id} update leaked to non-owner",
      "firestore.rules:184-189",
      () =>
        updateDoc(doc(authedDb("bob"), "checkouts", "co1"), {
          notes: "pwned",
        }),
    )
  })

  it("denies bob deleting alice's checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id} delete leaked to non-owner",
      "firestore.rules:190",
      () => deleteDoc(doc(authedDb("bob"), "checkouts", "co1")),
    )
  })

  it("denies tag-tap-as-bob reading alice's checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id} read leaked across tag-tap actsAs",
      "firestore.rules:158-160",
      () => getDoc(doc(tagSessionDb("bob"), "checkouts", "co1")),
    )
  })

  it("denies anonymous-auth reading another user's (real) checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id} read leaked to anonymous-auth session for non-null userId",
      "firestore.rules:158-160",
      () => getDoc(doc(anonAuthDb("anon-x"), "checkouts", "co1")),
    )
  })

  it("denies fully unauthenticated reading any checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id} read leaked to unauthenticated session",
      "firestore.rules:158-160",
      () => getDoc(doc(unauthDb(), "checkouts", "co1")),
    )
  })

  // Positive carve-outs
  it("allows alice reading her own checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertSucceeds(getDoc(doc(authedDb("alice"), "checkouts", "co1")))
  })

  it("allows tag-tap-as-alice reading alice's checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertSucceeds(getDoc(doc(tagSessionDb("alice"), "checkouts", "co1")))
  })

  it("allows admin reading any checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertSucceeds(getDoc(doc(adminDb(), "checkouts", "co1")))
  })

  // Intentionally permissive: anonymous-auth can read anonymous checkouts
  // (random doc IDs, no PII). If we ever tighten this, this assertion
  // forces an explicit test update rather than a silent break.
  it("allows any anonymous-auth session to read userId==null checkout (intentional)", async () => {
    await seedAnonCheckout("co-anon")
    await assertSucceeds(
      getDoc(doc(anonAuthDb("anon-x"), "checkouts", "co-anon")),
    )
  })
})

describe("cross-user: checkouts/{id}/items", () => {
  it("denies bob reading items in alice's checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await seedCheckoutItem("co1", "i1")
    await assertCrossUserDenied(
      "checkouts/{id}/items/{itemId} read leaked to non-owner",
      "firestore.rules:194-196",
      () => getDoc(doc(authedDb("bob"), "checkouts/co1/items/i1")),
    )
  })

  it("denies bob writing items into alice's open checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id}/items create leaked to non-owner",
      "firestore.rules:203-208",
      () =>
        setDoc(doc(authedDb("bob"), "checkouts/co1/items/i-bob"), {
          workshop: "holz",
          description: "victim charge",
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

  it("denies tag-tap-as-bob writing items into alice's checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts/{id}/items create leaked across tag-tap actsAs",
      "firestore.rules:203-208",
      () =>
        setDoc(doc(tagSessionDb("bob"), "checkouts/co1/items/i-bob"), {
          workshop: "holz",
          description: "victim charge",
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

  it("denies bob deleting an item in alice's checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await seedCheckoutItem("co1", "i1")
    await assertCrossUserDenied(
      "checkouts/{id}/items delete leaked to non-owner",
      "firestore.rules:215-218",
      () => deleteDoc(doc(authedDb("bob"), "checkouts/co1/items/i1")),
    )
  })

  // Positive baseline
  it("allows alice writing items to her own open checkout", async () => {
    await seedOpenCheckout("co1", "alice")
    await assertSucceeds(
      setDoc(doc(authedDb("alice"), "checkouts/co1/items/i1"), {
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
})

describe("cross-user: bills", () => {
  it("denies bob reading alice's bill", async () => {
    await seedBill("b1", "alice")
    await assertCrossUserDenied(
      "bills/{id} read leaked to non-owner",
      "firestore.rules:236-240",
      () => getDoc(doc(authedDb("bob"), "bills", "b1")),
    )
  })

  it("denies bob writing alice's bill", async () => {
    await seedBill("b1", "alice")
    await assertCrossUserDenied(
      "bills/{id} write reachable from client (must be server-only)",
      "firestore.rules:241",
      () =>
        updateDoc(doc(authedDb("bob"), "bills", "b1"), {
          amount: 0,
        }),
    )
  })

  it("denies tag-tap-as-bob reading alice's bill", async () => {
    await seedBill("b1", "alice")
    await assertCrossUserDenied(
      "bills/{id} read leaked across tag-tap actsAs",
      "firestore.rules:236-240",
      () => getDoc(doc(tagSessionDb("bob"), "bills", "b1")),
    )
  })

  it("denies anonymous-auth reading any bill", async () => {
    await seedBill("b1", "alice")
    await assertCrossUserDenied(
      "bills/{id} read leaked to anonymous-auth session",
      "firestore.rules:236-240",
      () => getDoc(doc(anonAuthDb("anon-x"), "bills", "b1")),
    )
  })

  it("denies alice writing her own bill (server-only collection)", async () => {
    await seedBill("b1", "alice")
    await assertCrossUserDenied(
      "bills/{id} write reachable from owner (must be server-only)",
      "firestore.rules:241",
      () =>
        updateDoc(doc(authedDb("alice"), "bills", "b1"), {
          amount: 0,
        }),
    )
  })

  // Positive carve-outs
  it("allows alice reading her own bill", async () => {
    await seedBill("b1", "alice")
    await assertSucceeds(getDoc(doc(authedDb("alice"), "bills", "b1")))
  })

  it("allows tag-tap-as-alice reading alice's bill", async () => {
    await seedBill("b1", "alice")
    await assertSucceeds(getDoc(doc(tagSessionDb("alice"), "bills", "b1")))
  })

  it("allows admin reading any bill", async () => {
    await seedBill("b1", "alice")
    await assertSucceeds(getDoc(doc(adminDb(), "bills", "b1")))
  })
})

describe("cross-user: usage_machine", () => {
  it("denies bob reading alice's usage record", async () => {
    await seedUsageMachine("u1", "alice")
    await assertCrossUserDenied(
      "usage_machine/{id} read leaked to non-owner",
      "firestore.rules:131-135",
      () => getDoc(doc(authedDb("bob"), "usage_machine", "u1")),
    )
  })

  it("denies bob writing a usage record for alice (only admin writes)", async () => {
    await assertCrossUserDenied(
      "usage_machine/{id} write reachable from client (must be admin-only)",
      "firestore.rules:136",
      () =>
        setDoc(doc(authedDb("bob"), "usage_machine", "u-bob"), {
          userId: doc(authedDb("bob"), "users/alice"),
          authenticationId: null,
          machine: doc(authedDb("bob"), "machine/m1"),
          startTime: serverTimestamp(),
          endTime: serverTimestamp(),
          endReason: null,
          checkoutItemRef: null,
          workshop: "holz",
        }),
    )
  })

  it("denies tag-tap-as-bob reading alice's usage", async () => {
    await seedUsageMachine("u1", "alice")
    await assertCrossUserDenied(
      "usage_machine/{id} read leaked across tag-tap actsAs",
      "firestore.rules:131-135",
      () => getDoc(doc(tagSessionDb("bob"), "usage_machine", "u1")),
    )
  })

  it("denies anonymous-auth reading any usage record", async () => {
    await seedUsageMachine("u1", "alice")
    await assertCrossUserDenied(
      "usage_machine/{id} read leaked to anonymous-auth session",
      "firestore.rules:131-135",
      () => getDoc(doc(anonAuthDb("anon-x"), "usage_machine", "u1")),
    )
  })

  // Positive carve-outs
  it("allows alice reading her own usage", async () => {
    await seedUsageMachine("u1", "alice")
    await assertSucceeds(
      getDoc(doc(authedDb("alice"), "usage_machine", "u1")),
    )
  })

  it("allows tag-tap-as-alice reading alice's usage", async () => {
    await seedUsageMachine("u1", "alice")
    await assertSucceeds(
      getDoc(doc(tagSessionDb("alice"), "usage_machine", "u1")),
    )
  })

  it("allows admin reading any usage record", async () => {
    await seedUsageMachine("u1", "alice")
    await assertSucceeds(getDoc(doc(adminDb(), "usage_machine", "u1")))
  })
})

describe("cross-user: tokens (currently admin-only)", () => {
  // Tokens have no owner-scoped read path today. These assertions document
  // the lockdown so any future rule loosening that adds an owner-scoped
  // read path forces an explicit test update + carve-out.
  it("denies alice reading any token (admin-only)", async () => {
    await seedToken("t1", "alice")
    await assertCrossUserDenied(
      "tokens/{id} read leaked to signed-in user (must be admin-only)",
      "firestore.rules:113",
      () => getDoc(doc(authedDb("alice"), "tokens", "t1")),
    )
  })

  it("denies bob reading any token", async () => {
    await seedToken("t1", "alice")
    await assertCrossUserDenied(
      "tokens/{id} read leaked to non-owner signed-in user",
      "firestore.rules:113",
      () => getDoc(doc(authedDb("bob"), "tokens", "t1")),
    )
  })

  it("denies tag-tap session reading any token", async () => {
    await seedToken("t1", "alice")
    await assertCrossUserDenied(
      "tokens/{id} read leaked to tag-tap session",
      "firestore.rules:113",
      () => getDoc(doc(tagSessionDb("alice"), "tokens", "t1")),
    )
  })

  it("denies anonymous-auth reading any token", async () => {
    await seedToken("t1", "alice")
    await assertCrossUserDenied(
      "tokens/{id} read leaked to anonymous-auth session",
      "firestore.rules:113",
      () => getDoc(doc(anonAuthDb("anon-x"), "tokens", "t1")),
    )
  })

  it("denies alice writing a token (admin-only)", async () => {
    await assertCrossUserDenied(
      "tokens/{id} write leaked to signed-in user (must be admin-only)",
      "firestore.rules:114",
      () =>
        setDoc(doc(authedDb("alice"), "tokens", "t-bad"), {
          userId: doc(authedDb("alice"), "users/alice"),
        }),
    )
  })

  // Positive carve-outs (admin)
  it("allows admin reading a token", async () => {
    await seedToken("t1", "alice")
    await assertSucceeds(getDoc(doc(adminDb(), "tokens", "t1")))
  })

  it("allows admin writing a token", async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), "tokens", "t-admin"), {
        userId: doc(adminDb(), "users/alice"),
      }),
    )
  })
})
