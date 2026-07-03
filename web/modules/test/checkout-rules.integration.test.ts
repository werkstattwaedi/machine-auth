// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Security rules tests for checkout create and item subcollection operations.
 *
 * Run with: npm run test:web:integration (from repo root)
 */

import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest"
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
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
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

/**
 * A kiosk tag-tap session: synthetic UID with an actsAs claim naming the
 * real user. Mirrors what verifyTagCheckout mints in production.
 */
function tagSessionDb(realUserUid: string, sessionUid?: string) {
  const sid = sessionUid ?? `tag:${realUserUid}:s1`
  return getTestEnvironment()
    .authenticatedContext(sid, { actsAs: realUserUid, tagCheckout: true })
    .firestore()
}

/**
 * A Firebase Anonymous Auth session — what the truly-anonymous checkout
 * path uses. The `firebase.sign_in_provider` claim mirrors what real
 * signInAnonymously() tokens carry; rules read this to gate writes
 * scoped to a single anonymous principal.
 */
function anonAuthDb(uid: string) {
  return getTestEnvironment()
    .authenticatedContext(uid, {
      firebase: { sign_in_provider: "anonymous", identities: {} },
    })
    .firestore()
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
    // Issue #318: every client-side create must stamp firebaseUid
    // with the caller's own auth.uid.
    firebaseUid: ownerUid,
  })
}

describe("Checkout create rules", () => {
  it("allows creating an open checkout (signed-in stamps firebaseUid)", async () => {
    // Issue #318: every client-side create must stamp firebaseUid with
    // the caller's own auth.uid — signed-in too, not just anon.
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
        firebaseUid: "u1",
      }),
    )
  })

  it("allows anonymous-auth client to create a closed checkout", async () => {
    const db = anonAuthDb("anon-1")
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
        // Issue #318: every client-side create must stamp firebaseUid
        // with the caller's own auth.uid so the cleanup job can pair
        // an expired anon auth user with the checkouts they created.
        firebaseUid: "anon-1",
        closedAt: serverTimestamp(),
        notes: null,
        summary: { totalPrice: 15, entryFees: 15, machineCost: 0, materialCost: 0, tip: 0 },
      }),
    )
  })

  it("rejects anon-auth create that forges another anon session's UID", async () => {
    // Issue #318: firebaseUid must match the caller's own auth.uid;
    // an anon session cannot steal another's checkout slot by spoofing.
    const db = anonAuthDb("anon-1")
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: null,
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
        firebaseUid: "anon-2", // forged
      }),
    )
  })

  it("rejects anon-auth create that omits firebaseUid", async () => {
    // Issue #318: client creates without firebaseUid leak past the
    // cleanup job (no way to pair with the auth user). Reject so we
    // never re-introduce the orphan.
    const db = anonAuthDb("anon-1")
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: null,
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
        // no firebaseUid
      }),
    )
  })

  it("rejects signed-in create that omits firebaseUid", async () => {
    // Issue #318: signed-in client creates without firebaseUid would
    // also leave the doc unpaired with its auth principal. Reject so
    // the field stays mandatory for every client-side create.
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: doc(db, "users/u1"),
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: "u1",
        modifiedAt: serverTimestamp(),
        // no firebaseUid
      }),
    )
  })

  it("rejects signed-in create that stamps a different user's firebaseUid", async () => {
    // Issue #318: forge protection applies to signed-in callers too —
    // u1 cannot tag a checkout with u2's UID.
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: doc(db, "users/u1"),
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: "u1",
        modifiedAt: serverTimestamp(),
        firebaseUid: "u2", // forged
      }),
    )
  })

  it("rejects fully unauthenticated create even with userId == null", async () => {
    // After Phase C, anonymous = Firebase Anonymous Auth. The legacy
    // unauthenticated `if true` create branch is gone.
    const db = unauthDb()
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: null,
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
        firebaseUid: "u1",
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
        firebaseUid: "u1",
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
        firebaseUid: "u1",
        extraField: "not allowed",
      }),
    )
  })

  // R2 in Security Analysis: an unauthenticated client could previously
  // stamp a victim's userId on a checkout. Must be rejected.
  it("rejects unauthenticated create that targets another user's userId", async () => {
    const anonDb = unauthDb()
    await assertFails(
      addDoc(collection(anonDb, "checkouts"), {
        userId: doc(anonDb, "users/victim"),
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
      }),
    )
  })

  // Same attack from a signed-in but unrelated user: u1 cannot create a
  // checkout that names u2 as the owner.
  it("rejects signed-in create that targets a different user's userId", async () => {
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts"), {
        userId: doc(db, "users/u2"),
        status: "open",
        usageType: "regular",
        created: serverTimestamp(),
        workshopsVisited: [],
        persons: [],
        modifiedBy: null,
        modifiedAt: serverTimestamp(),
        firebaseUid: "u1",
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
      firebaseUid: "u1",
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

  it("allows anonymous-auth client to add items to anonymous checkout (userId == null)", async () => {
    // Create anonymous open checkout via Firebase Anonymous Auth context
    const anonDb = anonAuthDb("anon-1")
    await setDoc(doc(anonDb, "checkouts", "co-anon"), {
      userId: null,
      status: "open",
      usageType: "regular",
      created: serverTimestamp(),
      workshopsVisited: ["holz"],
      persons: [],
      modifiedBy: null,
      modifiedAt: serverTimestamp(),
      firebaseUid: "anon-1",
    })

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

  it("rejects fully unauthenticated client from adding items to anonymous checkout", async () => {
    // Set up the checkout via the anonymous-auth principal that legitimately
    // owns this flow.
    const setupDb = anonAuthDb("anon-1")
    await setDoc(doc(setupDb, "checkouts", "co-anon"), {
      userId: null,
      status: "open",
      usageType: "regular",
      created: serverTimestamp(),
      workshopsVisited: [],
      persons: [],
      modifiedBy: null,
      modifiedAt: serverTimestamp(),
      firebaseUid: "anon-1",
    })

    // A fully unauthenticated client must not be able to write items.
    const unauth = unauthDb()
    await assertFails(
      addDoc(collection(unauth, "checkouts", "co-anon", "items"), {
        workshop: "holz",
        description: "stolen item",
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

  // R3 in Security Analysis: rules-level field validation rejects negative
  // quantities/prices. Server-side recompute is the authoritative defense
  // (Phase A5), but this is a cheap guard.
  //
  // Issue #151: `quantity: 0` is allowed at the rules layer because newly
  // added catalog items start at 0 until the user fills in the form.
  // The server-side recompute (`isValidItem` in
  // closeCheckoutAndGetPayment) drops zero-quantity items from the bill.
  it("allows items with zero quantity (in-progress catalog selection)", async () => {
    await createOpenCheckout("co1", "u1")
    const db = authedDb("u1")
    await assertSucceeds(
      addDoc(collection(db, "checkouts", "co1", "items"), {
        workshop: "holz",
        description: "in-progress",
        origin: "manual",
        catalogId: null,
        created: serverTimestamp(),
        quantity: 0,
        unitPrice: 1,
        totalPrice: 0,
        formInputs: null,
      }),
    )
  })

  it("rejects items with negative quantity", async () => {
    await createOpenCheckout("co1", "u1")
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts", "co1", "items"), {
        workshop: "holz",
        description: "broken",
        origin: "manual",
        catalogId: null,
        created: serverTimestamp(),
        quantity: -1,
        unitPrice: 1,
        totalPrice: -1,
        formInputs: null,
      }),
    )
  })

  it("rejects items with negative unitPrice", async () => {
    await createOpenCheckout("co1", "u1")
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts", "co1", "items"), {
        workshop: "holz",
        description: "discount mint",
        origin: "manual",
        catalogId: null,
        created: serverTimestamp(),
        quantity: 1,
        unitPrice: -100,
        totalPrice: -100,
        formInputs: null,
      }),
    )
  })

  // A kiosk tag-tap session is a synthetic UID with an `actsAs` claim.
  // It must be able to add items to the real user's open checkout.
  it("allows tag-tap session (actsAs claim) to add items to real user's checkout", async () => {
    await createOpenCheckout("co1", "u1")
    const db = tagSessionDb("u1")
    await assertSucceeds(
      addDoc(collection(db, "checkouts", "co1", "items"), {
        workshop: "holz",
        description: "Schleifpapier",
        origin: "manual",
        catalogId: null,
        created: serverTimestamp(),
        quantity: 1,
        unitPrice: 3,
        totalPrice: 3,
        formInputs: null,
      }),
    )
  })

  // …but only for the user it actually claims to act as. A tag-tap session
  // for u1 must NOT be able to write to u2's checkout.
  it("rejects tag-tap session writing to a different user's checkout", async () => {
    await createOpenCheckout("co2", "u2")
    const db = tagSessionDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts", "co2", "items"), {
        workshop: "holz",
        description: "victim charge",
        origin: "manual",
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

describe("Checkout read rules (R1: cross-user leak fix)", () => {
  it("rejects a different signed-in user from reading another user's checkout", async () => {
    await createOpenCheckout("co1", "u1")

    const u2db = authedDb("u2")
    await assertFails(getDoc(doc(u2db, "checkouts", "co1")))
  })

  it("allows the owner to read their own checkout", async () => {
    await createOpenCheckout("co1", "u1")

    const u1db = authedDb("u1")
    await assertSucceeds(getDoc(doc(u1db, "checkouts", "co1")))
  })

  it("allows a tag-tap session for u1 to read u1's checkout", async () => {
    await createOpenCheckout("co1", "u1")

    const tagDb = tagSessionDb("u1")
    await assertSucceeds(getDoc(doc(tagDb, "checkouts", "co1")))
  })

  it("rejects a tag-tap session for u2 from reading u1's checkout", async () => {
    await createOpenCheckout("co1", "u1")

    const tagDb = tagSessionDb("u2")
    await assertFails(getDoc(doc(tagDb, "checkouts", "co1")))
  })
})

describe("Anonymous open-checkout lookup keys on firebaseUid, not modifiedBy", () => {
  // Regression for the anon-checkout-after-logout bug. The open-checkout
  // query (wizard-context.tsx + routes/index.tsx) must scope on
  // `firebaseUid` — the stable, rules-enforced creator id — NOT the
  // `modifiedBy` audit field. In production `modifiedBy` is stamped from the
  // AuthProvider's React `user` state, which lags the SDK: a checkout
  // created right after a logout → eager-anon transition lands with
  // `modifiedBy: null` even though `firebaseUid` holds the anon UID. A query
  // on `modifiedBy` then never matches its own freshly-created doc — the
  // checkout exists in Firestore but the UI shows "Kein offener Besuch"
  // after a reload.
  it("finds the anon's own open checkout via firebaseUid even when modifiedBy is null", async () => {
    const anonUid = "anon-1"
    const db = anonAuthDb(anonUid)
    // Mirror production: modifiedBy clobbered to null by the lagging audit
    // stamp; firebaseUid carries the real creator UID.
    await addDoc(collection(db, "checkouts"), {
      userId: null,
      status: "open",
      usageType: "regular",
      created: serverTimestamp(),
      workshopsVisited: [],
      persons: [{ name: "a s", email: "a@b.c", userType: "erwachsen" }],
      modifiedBy: null,
      modifiedAt: serverTimestamp(),
      firebaseUid: anonUid,
    })

    // The fixed query: keyed on firebaseUid → finds the doc.
    const found = await getDocs(
      query(
        collection(db, "checkouts"),
        where("userId", "==", null),
        where("firebaseUid", "==", anonUid),
        where("status", "==", "open"),
      ),
    )
    expect(found.size).toBe(1)

    // The pre-fix query keyed on modifiedBy → misses the very doc this
    // session just created. Encodes the regression so a revert fails loudly.
    const missed = await getDocs(
      query(
        collection(db, "checkouts"),
        where("userId", "==", null),
        where("modifiedBy", "==", anonUid),
        where("status", "==", "open"),
      ),
    )
    expect(missed.size).toBe(0)
  })
})

describe("Server-only collections deny rules", () => {
  it("denies client read of authentications", async () => {
    const db = authedDb("u1")
    await assertFails(getDoc(doc(db, "authentications", "any")))
  })

  it("denies client write of authentications", async () => {
    const db = authedDb("u1")
    await assertFails(setDoc(doc(db, "authentications", "any"), { foo: 1 }))
  })

  it("denies client read of operations_log", async () => {
    const db = authedDb("u1")
    await assertFails(getDoc(doc(db, "operations_log", "any")))
  })

  it("denies client write of operations_log", async () => {
    const db = authedDb("u1")
    await assertFails(setDoc(doc(db, "operations_log", "any"), { foo: 1 }))
  })
})

describe("Badge item field protection (tokenId / badgeSdmCounter are server-only)", () => {
  const badgeItemBase = {
    workshop: "diverses",
    description: "Badge",
    origin: "manual",
    catalogId: null,
    created: serverTimestamp(),
    quantity: 1,
    unitPrice: 5,
    totalPrice: 5,
    formInputs: null,
  }

  /** Seed a SERVER-written badge item (Admin SDK bypasses rules). */
  async function seedBadgeItem(checkoutId: string, itemId: string) {
    await getTestEnvironment().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "checkouts", checkoutId, "items", itemId),
        { ...badgeItemBase, tokenId: "04c339aa1e1890", badgeSdmCounter: 7 },
      )
    })
  }

  it("owner cannot create an item carrying tokenId (badge squatting)", async () => {
    await createOpenCheckout("co-b1", "u1")
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts", "co-b1", "items"), {
        ...badgeItemBase,
        tokenId: "04c339aa1e1890",
      }),
    )
  })

  it("owner cannot create an item carrying badgeSdmCounter", async () => {
    await createOpenCheckout("co-b2", "u1")
    const db = authedDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts", "co-b2", "items"), {
        ...badgeItemBase,
        badgeSdmCounter: 7,
      }),
    )
  })

  it("tag session cannot create an item carrying tokenId either", async () => {
    await createOpenCheckout("co-b3", "u1")
    const db = tagSessionDb("u1")
    await assertFails(
      addDoc(collection(db, "checkouts", "co-b3", "items"), {
        ...badgeItemBase,
        tokenId: "04c339aa1e1890",
      }),
    )
  })

  it("anonymous-auth session cannot create an item carrying tokenId on a null-userId checkout", async () => {
    const anonDb = anonAuthDb("anon-b1")
    await setDoc(doc(anonDb, "checkouts", "co-b4"), {
      userId: null,
      status: "open",
      usageType: "regular",
      created: serverTimestamp(),
      workshopsVisited: [],
      persons: [],
      modifiedBy: null,
      modifiedAt: serverTimestamp(),
      firebaseUid: "anon-b1",
    })
    await assertFails(
      addDoc(collection(anonDb, "checkouts", "co-b4", "items"), {
        ...badgeItemBase,
        tokenId: "04c339aa1e1890",
      }),
    )
  })

  it("owner cannot alter or strip tokenId on a server-written badge item", async () => {
    await createOpenCheckout("co-b5", "u1")
    await seedBadgeItem("co-b5", "item-1")
    const db = authedDb("u1")
    const ref = doc(db, "checkouts", "co-b5", "items", "item-1")
    // Re-pointing the association target must fail…
    await assertFails(updateDoc(ref, { tokenId: "04ffffffffffff" }))
    // …and so must zeroing the replay-defense counter seed.
    await assertFails(updateDoc(ref, { badgeSdmCounter: 0 }))
  })

  it("owner CAN update unrelated fields of a badge item and CAN delete it (cart removal)", async () => {
    await createOpenCheckout("co-b6", "u1")
    await seedBadgeItem("co-b6", "item-1")
    const db = authedDb("u1")
    const ref = doc(db, "checkouts", "co-b6", "items", "item-1")
    await assertSucceeds(updateDoc(ref, { description: "Badge (neu)" }))
    await assertSucceeds(deleteDoc(ref))
  })

  it("tag session can delete a badge item from the acted-for user's checkout", async () => {
    await createOpenCheckout("co-b7", "u1")
    await seedBadgeItem("co-b7", "item-1")
    const db = tagSessionDb("u1")
    await assertSucceeds(
      deleteDoc(doc(db, "checkouts", "co-b7", "items", "item-1")),
    )
  })

  it("tokens stay unreadable/unwritable for kiosk tag sessions", async () => {
    const db = tagSessionDb("u1")
    await assertFails(getDoc(doc(db, "tokens", "04c339aa1e1890")))
    await assertFails(
      setDoc(doc(db, "tokens", "04c339aa1e1890"), {
        userId: doc(db, "users", "u1"),
        registered: serverTimestamp(),
      }),
    )
  })
})
