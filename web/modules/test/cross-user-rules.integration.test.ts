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
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
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

/**
 * OTP-elevated kiosk session (ADR-0041): the same synthetic principal with
 * an `elevatedUntil` claim. `expired` stamps a deadline in the past — the
 * rules must treat that exactly like a plain badge tap.
 */
function elevatedTagSessionDb(
  realUserUid: string,
  opts: { expired?: boolean } = {},
) {
  const elevatedUntil = opts.expired
    ? Date.now() - 60_000
    : Date.now() + 15 * 60_000
  return getTestEnvironment()
    .authenticatedContext(`tag:${realUserUid}:s1`, {
      actsAs: realUserUid,
      tagCheckout: true,
      elevatedUntil,
    })
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
      firstName: "User",
      lastName: uid,
      email: `${uid}@test.com`,
      roles: [],
      permissions: [],
      userType: "erwachsen",
      activeMembership: null,
      ...overrides,
    })
}

async function seedMembership(
  membershipId: string,
  ownerUid: string,
  type: "single" | "family" = "single",
  memberUids: string[] = [ownerUid],
  status: "active" | "expired" | "cancelled" = "active",
) {
  const db = getAdminFirestore()
  const memberRefs = memberUids.map((uid) => db.doc(`users/${uid}`))
  await db
    .collection("memberships")
    .doc(membershipId)
    .set({
      type,
      status,
      lastPaidAt: FieldValue.serverTimestamp(),
      validUntil: FieldValue.serverTimestamp(),
      ownerUserId: db.doc(`users/${ownerUid}`),
      members: memberRefs,
      paymentCheckouts: [],
      // Issue #323: annual auto-renewal fields. Seeded so the read tests
      // exercise a membership doc that actually carries them — proving the
      // new client-readable fields don't widen read access.
      autoRenew: true,
      pendingRenewalBill: null,
      notes: null,
      created: FieldValue.serverTimestamp(),
      modifiedAt: FieldValue.serverTimestamp(),
      modifiedBy: null,
    })
  // Set the denormalized activeMembership pointer on each member so the
  // family-roster join rule can resolve their docs against each other.
  for (const memberUid of memberUids) {
    await db
      .collection("users")
      .doc(memberUid)
      .set(
        {
          activeMembership: db.doc(`memberships/${membershipId}`),
        },
        { merge: true },
      )
  }
}

async function seedMembershipInvite(
  membershipId: string,
  inviteId: string,
  email: string,
) {
  const db = getAdminFirestore()
  await db
    .collection("memberships")
    .doc(membershipId)
    .collection("invites")
    .doc(inviteId)
    .set({
      email: email.toLowerCase(),
      status: "pending",
      invitedAt: FieldValue.serverTimestamp(),
      invitedBy: db.doc(`users/owner-stub`),
      resolvedAt: null,
      ttlAt: FieldValue.serverTimestamp(),
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

async function seedAnonCheckout(checkoutId: string, firebaseUid = "anon-x") {
  const db = getAdminFirestore()
  await db
    .collection("checkouts")
    .doc(checkoutId)
    .set({
      userId: null,
      // Stamped by the client on create (issue #318) == the creating
      // anonymous-auth session's uid. P0-2 scopes anon reads/writes to
      // this so one anon session can't harvest another's checkout PII.
      firebaseUid,
      status: "open",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      workshopsVisited: ["holz"],
      persons: [],
      modifiedBy: null,
      modifiedAt: FieldValue.serverTimestamp(),
    })
}

async function seedClosedCheckout(
  checkoutId: string,
  ownerUid: string | null,
  extra: Record<string, unknown> = {},
) {
  const db = getAdminFirestore()
  await db
    .collection("checkouts")
    .doc(checkoutId)
    .set({
      userId: ownerUid ? db.doc(`users/${ownerUid}`) : null,
      status: "closed",
      usageType: "regular",
      created: FieldValue.serverTimestamp(),
      closedAt: FieldValue.serverTimestamp(),
      workshopsVisited: ["holz"],
      persons: [],
      summary: {
        totalPrice: 20,
        entryFees: 0,
        machineCost: 0,
        materialCost: 20,
        tip: 0,
      },
      modifiedBy: null,
      modifiedAt: FieldValue.serverTimestamp(),
      ...extra,
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

async function seedPrintJob(jobId: string) {
  const db = getAdminFirestore()
  await db
    .collection("printJobs")
    .doc(jobId)
    .set({
      bytesB64: "AAAA",
      tape: "18mm",
      status: "queued",
      createdBy: "admin-test",
      createdAt: FieldValue.serverTimestamp(),
      ttlAt: FieldValue.serverTimestamp(),
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
          firstName: "pwned",
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
          firstName: "pwned",
        }),
    )
  })

  // ADR-0041: an OTP-elevated kiosk session may edit the profile it acts on
  // — and nothing else. The e-mail (login-code lookup key) is pinned, roles
  // and permissions stay pinned, an expired claim is a plain tag session.
  it("allows elevated-tag-as-alice updating alice's profile fields", async () => {
    await seedUser("alice")
    await assertSucceeds(
      updateDoc(doc(elevatedTagSessionDb("alice"), "users", "alice"), {
        firstName: "Alicia",
        phone: "+41791234567",
      }),
    )
  })

  it("denies elevated-tag-as-alice changing alice's e-mail (account takeover)", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} e-mail change leaked to an elevated kiosk session",
      "firestore.rules users update (ADR-0041 email pin)",
      () =>
        updateDoc(doc(elevatedTagSessionDb("alice"), "users", "alice"), {
          email: "attacker@example.com",
        }),
    )
  })

  it("denies elevated-tag-as-alice granting roles/permissions", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} roles change leaked to an elevated kiosk session",
      "firestore.rules users update (ADR-0041 roles pin)",
      () =>
        updateDoc(doc(elevatedTagSessionDb("alice"), "users", "alice"), {
          roles: ["admin"],
        }),
    )
  })

  it("denies elevated-tag-as-bob updating alice's user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} update leaked across elevated kiosk actsAs",
      "firestore.rules users update (ADR-0041)",
      () =>
        updateDoc(doc(elevatedTagSessionDb("bob"), "users", "alice"), {
          firstName: "pwned",
        }),
    )
  })

  it("denies an EXPIRED elevated-tag-as-alice updating alice's user doc", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} update leaked to an expired kiosk elevation",
      "firestore.rules users update (ADR-0041 elevatedUntil)",
      () =>
        updateDoc(
          doc(elevatedTagSessionDb("alice", { expired: true }), "users", "alice"),
          { firstName: "late" },
        ),
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

  // Self-registration create invariants (combined sign-in/sign-up): the
  // create path enforces the same firma billing-address rule as update.
  //
  // A sign-up session carries the address it just verified as its token
  // e-mail, and the create rule pins `email` to it (ADR-0043). Every case
  // below registers with a MATCHING e-mail unless the e-mail is what it
  // tests — otherwise the roles/permissions/billing denials would pass on
  // the e-mail pin alone and stop guarding their own condition.
  const SIGNUP_EMAIL = "carol@example.com"
  function signupDb(uid: string, email: string = SIGNUP_EMAIL) {
    return getTestEnvironment().authenticatedContext(uid, { email }).firestore()
  }

  function signupDoc(overrides: Record<string, unknown> = {}) {
    return {
      firstName: "Carol",
      lastName: "Muster",
      email: SIGNUP_EMAIL,
      userType: "erwachsen",
      termsAcceptedAt: serverTimestamp(),
      roles: [],
      permissions: [],
      phone: null,
      billingAddress: null,
      created: serverTimestamp(),
      ...overrides,
    }
  }

  it("allows erwachsen self-registration without a billing address", async () => {
    await assertSucceeds(
      setDoc(doc(signupDb("carol"), "users", "carol"), signupDoc()),
    )
  })

  it("denies firma self-registration without a billing address", async () => {
    await assertFails(
      setDoc(
        doc(signupDb("carol"), "users", "carol"),
        signupDoc({ userType: "firma" }),
      ),
    )
  })

  it("allows firma self-registration with a complete billing address", async () => {
    await assertSucceeds(
      setDoc(
        doc(signupDb("carol"), "users", "carol"),
        signupDoc({
          userType: "firma",
          billingAddress: {
            company: "Holzbau Müller AG",
            street: "Seestrasse 12",
            zip: "8820",
            city: "Wädenswil",
          },
        }),
      ),
    )
  })

  // P0-1: privilege-escalation guard. The create path must pin roles and
  // permissions to empty, mirroring the update path. Doc ID == Auth UID
  // and syncCustomClaims stamps `admin` on any write whose roles[]
  // includes "admin", so an unconstrained create let any anonymous /
  // magic-link session self-grant admin (full auth bypass) or arbitrary
  // machine permissions. These assertions MUST fail against a loosened
  // create rule — they are the regression net for the most severe write
  // vector.
  it("denies self-registration granting roles:['admin'] (P0-1 full auth bypass)", async () => {
    await assertCrossUserDenied(
      "users/{id} create self-grants admin role",
      "firestore.rules:users create (roles == [])",
      () =>
        setDoc(
          doc(signupDb("mallory"), "users", "mallory"),
          signupDoc({ roles: ["admin"] }),
        ),
    )
  })

  it("denies an anonymous-auth session self-registering as admin (P0-1)", async () => {
    // The concrete exploit: a fresh anonymous session from the public
    // checkout app writes users/{ownUid} with an admin role.
    await assertCrossUserDenied(
      "users/{id} create self-grants admin from anon session",
      "firestore.rules:users create (roles == [])",
      () =>
        setDoc(
          doc(anonAuthDb("anon-mallory"), "users", "anon-mallory"),
          // No token e-mail on an anonymous session → register e-mail-less,
          // so the roles pin is the only thing left to deny this.
          signupDoc({ roles: ["admin"], email: null }),
        ),
    )
  })

  it("denies self-registration granting a non-empty permissions array (P0-1)", async () => {
    await assertCrossUserDenied(
      "users/{id} create self-grants machine permissions",
      "firestore.rules:users create (permissions == [])",
      () =>
        setDoc(
          doc(signupDb("mallory"), "users", "mallory"),
          signupDoc({
            permissions: [doc(signupDb("mallory"), "permission", "laser")],
          }),
        ),
    )
  })

  it("denies self-registration granting a non-admin role (only the admin path may grant roles) (P0-1)", async () => {
    await assertCrossUserDenied(
      "users/{id} create self-grants a role",
      "firestore.rules:users create (roles == [])",
      () =>
        setDoc(
          doc(signupDb("mallory"), "users", "mallory"),
          signupDoc({ roles: ["vereinsmitglied"] }),
        ),
    )
  })

  // ADR-0043: login resolves a verified address to the users doc carrying
  // it. A session that could register SOMEONE ELSE's address would either
  // pre-hijack that person's first login (their code signs them into this
  // uid) or lock an existing member out (two docs share the e-mail → login
  // refuses). These MUST fail against a create rule without the e-mail pin.
  it("denies self-registration under someone else's e-mail (login pre-hijack)", async () => {
    await assertCrossUserDenied(
      "users/{id} create registers a foreign e-mail",
      "firestore.rules:users create (email == token e-mail)",
      () =>
        setDoc(
          doc(signupDb("mallory", "mallory@example.com"), "users", "mallory"),
          signupDoc({ email: "victim@example.com" }),
        ),
    )
  })

  it("denies an anonymous-auth session registering a member's e-mail (login lock-out)", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{id} create from anon session squats a member's e-mail",
      "firestore.rules:users create (email == token e-mail)",
      () =>
        setDoc(
          doc(anonAuthDb("anon-mallory"), "users", "anon-mallory"),
          signupDoc({ email: "alice@test.com" }),
        ),
    )
  })

  it("denies alice changing her own e-mail (login identity moves via updateUserEmail only)", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} owner rewrote the login e-mail",
      "firestore.rules users update (ADR-0043 email pin)",
      () =>
        updateDoc(doc(authedDb("alice"), "users", "alice"), {
          email: "attacker@example.com",
        }),
    )
  })

  it("allows alice changing her own phone and name", async () => {
    await seedUser("alice")
    await assertSucceeds(
      updateDoc(doc(authedDb("alice"), "users", "alice"), {
        firstName: "Alicia",
        phone: "+41791234567",
      }),
    )
  })

  it("denies even an admin changing a user's e-mail client-side", async () => {
    // The admin profile tab writing `email` straight to Firestore is what
    // used to split members in two (issue #633). E-mail changes go through
    // the `updateUserEmail` callable — Admin SDK, not subject to rules —
    // which moves Firebase Auth and the doc together.
    await seedUser("alice")
    await assertCrossUserDenied(
      "users/{userId} admin client rewrote the login e-mail",
      "firestore.rules users update (ADR-0043 email pin, admin branch)",
      () =>
        updateDoc(doc(adminDb(), "users", "alice"), {
          email: "alice.new@test.com",
        }),
    )
  })

  it("allows admin editing everything else, incl. roles", async () => {
    await seedUser("alice")
    await assertSucceeds(
      updateDoc(doc(adminDb(), "users", "alice"), {
        firstName: "Alicia",
        phone: "+41791234567",
        roles: ["admin"],
      }),
    )
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

  // P0-2: anon reads are scoped to the CREATING session via `firebaseUid`.
  // The walk-in flow persists full PII (name, email, billing address) into
  // null-userId checkouts, so an unscoped anon branch let any
  // signInAnonymously() session harvest every guest's data. The creating
  // session (firebaseUid == its uid) still reads its own checkout.
  it("allows the creating anonymous-auth session to read its own userId==null checkout", async () => {
    await seedAnonCheckout("co-anon", "anon-x")
    await assertSucceeds(
      getDoc(doc(anonAuthDb("anon-x"), "checkouts", "co-anon")),
    )
  })

  it("denies a DIFFERENT anonymous-auth session from reading another anon session's checkout (P0-2 PII harvest)", async () => {
    await seedAnonCheckout("co-anon", "anon-x")
    await assertCrossUserDenied(
      "checkouts/{id} anon read leaked across anon sessions (P0-2 mass PII leak)",
      "firestore.rules:checkouts read (firebaseUid == request.auth.uid)",
      () => getDoc(doc(anonAuthDb("anon-other"), "checkouts", "co-anon")),
    )
  })

  it("denies a different anon session from reading items in another anon session's checkout (P0-2)", async () => {
    await seedAnonCheckout("co-anon", "anon-x")
    await seedCheckoutItem("co-anon", "i1")
    await assertCrossUserDenied(
      "checkouts/{id}/items anon read leaked across anon sessions (P0-2)",
      "firestore.rules:items read (isAnonParentCreator)",
      () => getDoc(doc(anonAuthDb("anon-other"), "checkouts/co-anon/items/i1")),
    )
  })

  // A client-created closed checkout gets a bill for its own
  // summary.totalPrice (onCheckoutCreatedClosed) — closes go through the
  // close callable only, for every principal.
  it("denies tag-tap-as-alice creating a closed checkout for alice", async () => {
    await assertCrossUserDenied(
      "checkouts/{id} closed create allowed for a tag-tap session",
      "firestore.rules:checkouts create (status == 'open')",
      () =>
        setDoc(doc(tagSessionDb("alice"), "checkouts", "co-forged"), {
          userId: doc(tagSessionDb("alice"), "users/alice"),
          status: "closed",
          usageType: "regular",
          created: serverTimestamp(),
          workshopsVisited: ["holz"],
          persons: [],
          modifiedBy: null,
          modifiedAt: serverTimestamp(),
          firebaseUid: "tag:alice:s1",
          closedAt: serverTimestamp(),
          summary: { totalPrice: 1, entryFees: 0, machineCost: 0, materialCost: 1, tip: 0 },
        }),
    )
  })

  it("denies an anonymous-auth session creating a closed checkout", async () => {
    await assertCrossUserDenied(
      "checkouts/{id} closed create allowed for an anon session",
      "firestore.rules:checkouts create (status == 'open')",
      () =>
        setDoc(doc(anonAuthDb("anon-x"), "checkouts", "co-forged"), {
          userId: null,
          status: "closed",
          usageType: "regular",
          created: serverTimestamp(),
          workshopsVisited: ["holz"],
          persons: [{ name: "Max", email: "someone@example.com", userType: "erwachsen" }],
          modifiedBy: null,
          modifiedAt: serverTimestamp(),
          firebaseUid: "anon-x",
          closedAt: serverTimestamp(),
          summary: { totalPrice: 999, entryFees: 0, machineCost: 0, materialCost: 999, tip: 0 },
        }),
    )
  })

  it("denies a different anon session from updating another anon session's open checkout (P0-2)", async () => {
    await seedAnonCheckout("co-anon", "anon-x")
    await assertCrossUserDenied(
      "checkouts/{id} anon update leaked across anon sessions (P0-2)",
      "firestore.rules:checkouts update (firebaseUid == request.auth.uid)",
      () =>
        updateDoc(doc(anonAuthDb("anon-other"), "checkouts", "co-anon"), {
          notes: "pwned",
        }),
    )
  })
})

describe("cross-user: cancelled checkouts + bills (ADR-0042)", () => {
  // Cancellation is server-only (the correctCheckouts callable). A
  // cancelled checkout is not open (no principal edits), so every client
  // write must fail while
  // owner + admin reads keep working for the "storniert" views.
  const cancelledExtra = {
    status: "cancelled",
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledBy: "admin-test",
    cancellationReason: "Doppelt erfasst",
    supersededByCheckoutRef: null,
    statsFlushedAt: null,
  }

  it("denies the owner writing paymentMethod on their cancelled checkout", async () => {
    await seedClosedCheckout("co1", "alice", cancelledExtra)
    await assertFails(
      updateDoc(doc(authedDb("alice"), "checkouts", "co1"), {
        paymentMethod: "raisenow",
      }),
    )
  })

  it("denies the owner cancelling their own closed checkout client-side", async () => {
    await seedClosedCheckout("co1", "alice")
    await assertFails(
      updateDoc(doc(authedDb("alice"), "checkouts", "co1"), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
      }),
    )
  })

  it("keeps a cancelled checkout readable by owner + admin, not by bob", async () => {
    await seedClosedCheckout("co1", "alice", cancelledExtra)
    await assertSucceeds(getDoc(doc(authedDb("alice"), "checkouts", "co1")))
    await assertSucceeds(getDoc(doc(adminDb(), "checkouts", "co1")))
    await assertCrossUserDenied(
      "cancelled checkouts/{id} read leaked to non-owner",
      "firestore.rules:checkouts read",
      () => getDoc(doc(authedDb("bob"), "checkouts", "co1")),
    )
  })

  it("keeps a cancelled bill readable by owner + admin, not by bob, and client-write-denied", async () => {
    await seedBill("b1", "alice")
    await getAdminFirestore().doc("bills/b1").update({
      cancelledAt: FieldValue.serverTimestamp(),
      cancellationReason: "Doppelt erfasst",
    })
    await assertSucceeds(getDoc(doc(authedDb("alice"), "bills", "b1")))
    await assertSucceeds(getDoc(doc(adminDb(), "bills", "b1")))
    await assertCrossUserDenied(
      "cancelled bills/{id} read leaked to non-owner",
      "firestore.rules:bills read",
      () => getDoc(doc(authedDb("bob"), "bills", "b1")),
    )
    await assertFails(
      updateDoc(doc(adminDb(), "bills", "b1"), { cancelledAt: null }),
    )
  })
})

describe("cross-user: closed checkouts take no client writes", () => {
  // Until #750 the customer picked the method on the closed checkout
  // (#251's carve-out). The close callable now commits it with the bill
  // and a correction creates a new checkout, so a client-set method could
  // only contradict the bill — denied to everyone, owner included.
  const ackPayload = { paymentMethod: "rechnung" }

  it("denies bob writing paymentMethod on alice's closed checkout", async () => {
    await seedClosedCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts paymentMethod write leaked to non-owner",
      "firestore.rules:checkouts.update",
      () => updateDoc(doc(authedDb("bob"), "checkouts", "co1"), ackPayload),
    )
  })

  it("denies an anonymous-auth session writing paymentMethod on an owned (real-userId) closed checkout", async () => {
    await seedClosedCheckout("co1", "alice")
    await assertCrossUserDenied(
      "checkouts paymentMethod write leaked to anon-auth on real-user doc",
      "firestore.rules:checkouts.update",
      () => updateDoc(doc(anonAuthDb("anon-x"), "checkouts", "co1"), ackPayload),
    )
  })

  it("denies a DIFFERENT anon session from writing paymentMethod on another anon session's closed checkout (P0-2)", async () => {
    await seedClosedCheckout("co-anon", null, { firebaseUid: "anon-x" })
    await assertCrossUserDenied(
      "checkouts paymentMethod write leaked across anon sessions (P0-2)",
      "firestore.rules:checkouts.update (firebaseUid == request.auth.uid)",
      () =>
        updateDoc(doc(anonAuthDb("anon-other"), "checkouts", "co-anon"), {
          paymentMethod: "raisenow",
        }),
    )
  })

  it("denies a real user writing paymentMethod on a null-userId closed checkout", async () => {
    await seedClosedCheckout("co-anon", null)
    await assertCrossUserDenied(
      "checkouts paymentMethod write leaked to real user on null-userId doc",
      "firestore.rules:checkouts.update",
      () =>
        updateDoc(doc(authedDb("alice"), "checkouts", "co-anon"), {
          paymentMethod: "rechnung",
        }),
    )
  })

  it("denies the owner changing paymentMethod on their own closed checkout", async () => {
    await seedClosedCheckout("co1", "alice", { paymentMethod: "rechnung" })
    await assertFails(
      updateDoc(doc(authedDb("alice"), "checkouts", "co1"), {
        paymentMethod: "raisenow",
      }),
    )
  })

  it("denies a member switching their closed checkout to monthly", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice")
    await seedClosedCheckout("co1", "alice")
    await assertFails(
      updateDoc(doc(authedDb("alice"), "checkouts", "co1"), {
        paymentMethod: "monthly",
      }),
    )
  })

  it("denies the tag-tap session writing paymentMethod on its principal's closed checkout", async () => {
    await seedClosedCheckout("co1", "alice")
    await assertFails(
      updateDoc(doc(tagSessionDb("alice"), "checkouts", "co1"), ackPayload),
    )
  })

  it("denies the creating anonymous-auth session writing paymentMethod on its closed checkout", async () => {
    await seedClosedCheckout("co-anon", null, { firebaseUid: "anon-x" })
    await assertFails(
      updateDoc(doc(anonAuthDb("anon-x"), "checkouts", "co-anon"), {
        paymentMethod: "raisenow",
      }),
    )
  })

  // ADR-0051: a terminal-paid checkout must keep the method its paid
  // bill was minted with.
  it("denies the owner relabelling a terminal-paid checkout", async () => {
    await seedClosedCheckout("co1", "alice", {
      paymentMethod: "wallee_terminal",
      walleeTransactionId: 1001,
    })
    await assertFails(
      updateDoc(doc(authedDb("alice"), "checkouts", "co1"), ackPayload),
    )
  })

  it("denies the creating anonymous session relabelling its terminal-paid checkout", async () => {
    await seedClosedCheckout("co-anon", null, {
      firebaseUid: "anon-x",
      paymentMethod: "wallee_terminal",
      walleeTransactionId: 1002,
    })
    await assertFails(
      updateDoc(doc(anonAuthDb("anon-x"), "checkouts", "co-anon"), ackPayload),
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

  // Issue #753: once its checkout is closed, the creating anonymous session
  // can no longer change its items — the same freeze the identified
  // principal already had. The bill is minted from the items at close, so
  // later writes would leave items that were never billed (statistics
  // export, ADR-0042 corrections, a regenerated PDF read them).
  it("denies the creating anon session creating an item on its closed checkout", async () => {
    await seedClosedCheckout("co-anon", null, { firebaseUid: "anon-x" })
    await assertCrossUserDenied(
      "checkouts/{id}/items create on a CLOSED anon checkout (#753)",
      "firestore.rules:items create (isAnonParentCreator + status open)",
      () =>
        setDoc(doc(anonAuthDb("anon-x"), "checkouts/co-anon/items/i-late"), {
          workshop: "holz",
          description: "after close",
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

  it("denies the creating anon session updating an item on its closed checkout", async () => {
    await seedClosedCheckout("co-anon", null, { firebaseUid: "anon-x" })
    await seedCheckoutItem("co-anon", "i1")
    await assertCrossUserDenied(
      "checkouts/{id}/items update on a CLOSED anon checkout (#753)",
      "firestore.rules:items update (isAnonParentCreator + status open)",
      () =>
        updateDoc(doc(anonAuthDb("anon-x"), "checkouts/co-anon/items/i1"), {
          quantity: 2,
          totalPrice: 40,
        }),
    )
  })

  it("denies the creating anon session deleting an item on its closed checkout", async () => {
    await seedClosedCheckout("co-anon", null, { firebaseUid: "anon-x" })
    await seedCheckoutItem("co-anon", "i1")
    await assertCrossUserDenied(
      "checkouts/{id}/items delete on a CLOSED anon checkout (#753)",
      "firestore.rules:items delete (isAnonParentCreator + status open)",
      () => deleteDoc(doc(anonAuthDb("anon-x"), "checkouts/co-anon/items/i1")),
    )
  })

  it("still lets the creating anon session read items on its closed checkout", async () => {
    await seedClosedCheckout("co-anon", null, { firebaseUid: "anon-x" })
    await seedCheckoutItem("co-anon", "i1")
    await assertSucceeds(
      getDoc(doc(anonAuthDb("anon-x"), "checkouts/co-anon/items/i1")),
    )
  })

  it("still lets the creating anon session change items on its open checkout", async () => {
    await seedAnonCheckout("co-anon", "anon-x")
    await seedCheckoutItem("co-anon", "i1")
    const db = anonAuthDb("anon-x")
    await assertSucceeds(
      updateDoc(doc(db, "checkouts/co-anon/items/i1"), {
        quantity: 2,
        totalPrice: 40,
      }),
    )
    await assertSucceeds(deleteDoc(doc(db, "checkouts/co-anon/items/i1")))
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

describe("cross-user: memberships", () => {
  it("denies bob reading alice's membership", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice")
    await assertCrossUserDenied(
      "memberships/{id} read leaked to non-member",
      "firestore.rules: memberships read",
      () => getDoc(doc(authedDb("bob"), "memberships", "m1")),
    )
  })

  it("denies any client write on memberships (callable-only)", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "memberships/{id} create leaked to client (must be callable-only)",
      "firestore.rules: memberships write deny",
      () =>
        setDoc(doc(authedDb("alice"), "memberships", "new"), {
          type: "single",
          status: "active",
          ownerUserId: doc(authedDb("alice"), "users/alice"),
          members: [doc(authedDb("alice"), "users/alice")],
          paymentCheckouts: [],
          validUntil: serverTimestamp(),
          lastPaidAt: null,
        }),
    )
  })

  // Issue #422: a kiosk tag-tap session may now read the membership it
  // BELONGS to (so the tapped user can resolve their own family roster
  // for the checkout quick-add). This intentionally inverts the prior
  // "tag sessions excluded" exclusion — but only for the tag owner's own
  // membership; the boundary negative immediately below proves an
  // unrelated membership is still denied.
  it("allows tag-tap-as-alice reading alice's own membership (issue #422)", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice", "family", ["alice"])
    await assertSucceeds(getDoc(doc(tagSessionDb("alice"), "memberships", "m1")))
  })

  it("allows tag-tap-as-bob (family co-member) reading the shared membership (issue #422)", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await seedMembership("m1", "alice", "family", ["alice", "bob"])
    await assertSucceeds(getDoc(doc(tagSessionDb("bob"), "memberships", "m1")))
  })

  it("denies tag-tap-as-bob reading alice's UNRELATED membership (boundary intact, #422)", async () => {
    await seedUser("alice")
    await seedUser("bob")
    // Bob shares no membership with Alice — his synthetic tag session must
    // not reach a membership he isn't a member of.
    await seedMembership("m1", "alice", "single", ["alice"])
    await assertCrossUserDenied(
      "memberships/{id} read leaked across tag-tap actsAs to unrelated membership",
      "firestore.rules: memberships read (actsAs in members)",
      () => getDoc(doc(tagSessionDb("bob"), "memberships", "m1")),
    )
  })

  it("denies a tag-tap session writing a membership (mutation boundary intact, #422)", async () => {
    await seedUser("alice")
    await assertCrossUserDenied(
      "memberships/{id} create leaked to tag-tap session (must be callable-only)",
      "firestore.rules: memberships write deny",
      () =>
        setDoc(doc(tagSessionDb("alice"), "memberships", "new"), {
          type: "single",
          status: "active",
          ownerUserId: doc(tagSessionDb("alice"), "users/alice"),
          members: [doc(tagSessionDb("alice"), "users/alice")],
          paymentCheckouts: [],
          validUntil: serverTimestamp(),
          lastPaidAt: null,
        }),
    )
  })

  it("denies anonymous-auth reading a membership", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice")
    await assertCrossUserDenied(
      "memberships/{id} read leaked to anonymous-auth session",
      "firestore.rules: memberships read",
      () => getDoc(doc(anonAuthDb("anon-x"), "memberships", "m1")),
    )
  })

  // Positive carve-outs
  it("allows alice reading her own single membership", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice")
    await assertSucceeds(getDoc(doc(authedDb("alice"), "memberships", "m1")))
  })

  it("allows admin reading any membership", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice")
    await assertSucceeds(getDoc(doc(adminDb(), "memberships", "m1")))
  })

  it("allows family co-member reading the shared membership", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await seedMembership("m1", "alice", "family", ["alice", "bob"])
    await assertSucceeds(getDoc(doc(authedDb("bob"), "memberships", "m1")))
  })

  // Issue #323: the auto-renewal fields (autoRenew, pendingRenewalBill) are
  // client-readable but callable-only for writes — they must NOT open a
  // cross-user leak nor a client write path.
  it("denies bob reading alice's membership even with auto-renewal fields present", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice")
    await assertCrossUserDenied(
      "memberships/{id} read leaked to non-member (#323 fields)",
      "firestore.rules: memberships read",
      () => getDoc(doc(authedDb("bob"), "memberships", "m1")),
    )
  })

  it("denies the owner client-side toggling autoRenew (callable-only, #323)", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice")
    await assertCrossUserDenied(
      "memberships/{id} autoRenew write leaked to client (must be callable-only)",
      "firestore.rules: memberships write deny",
      () =>
        updateDoc(doc(authedDb("alice"), "memberships", "m1"), {
          autoRenew: false,
        }),
    )
  })

  it("denies a non-owner client-side toggling autoRenew on another's membership (#323)", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await seedMembership("m1", "alice")
    await assertCrossUserDenied(
      "memberships/{id} autoRenew write leaked across users",
      "firestore.rules: memberships write deny",
      () =>
        updateDoc(doc(authedDb("bob"), "memberships", "m1"), {
          autoRenew: false,
        }),
    )
  })
})

describe("cross-user: membership invites", () => {
  function authedDbWithEmail(uid: string, email: string) {
    return getTestEnvironment()
      .authenticatedContext(uid, { email })
      .firestore()
  }

  it("denies non-invitee, non-owner reading an invite", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice", "family", ["alice"])
    await seedMembershipInvite("m1", "i1", "carol@test.com")
    await assertCrossUserDenied(
      "memberships/{id}/invites read leaked to unrelated user",
      "firestore.rules: invites read",
      () =>
        getDoc(doc(authedDb("bob"), "memberships", "m1", "invites", "i1")),
    )
  })

  it("allows the invitee (matching email) to read their invite", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice", "family", ["alice"])
    await seedMembershipInvite("m1", "i1", "carol@test.com")
    await assertSucceeds(
      getDoc(
        doc(
          authedDbWithEmail("carol", "carol@test.com"),
          "memberships",
          "m1",
          "invites",
          "i1",
        ),
      ),
    )
  })

  it("allows the family owner to read invites", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice", "family", ["alice"])
    await seedMembershipInvite("m1", "i1", "carol@test.com")
    await assertSucceeds(
      getDoc(doc(authedDb("alice"), "memberships", "m1", "invites", "i1")),
    )
  })

  it("denies any client write on invites (callable-only)", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice", "family", ["alice"])
    await assertCrossUserDenied(
      "invites write leaked to client (must be callable-only)",
      "firestore.rules: invites write deny",
      () =>
        setDoc(
          doc(authedDb("alice"), "memberships", "m1", "invites", "i-bad"),
          {
            email: "x@test.com",
            status: "pending",
            invitedAt: serverTimestamp(),
            invitedBy: doc(authedDb("alice"), "users/alice"),
            resolvedAt: null,
            ttlAt: serverTimestamp(),
          },
        ),
    )
  })
})

describe("cross-user: printJobs (admin-only)", () => {
  // printJobs has no owner-scoped path — only admins enqueue/read, and the
  // gateway service account (which bypasses rules) writes status. These
  // assertions lock that down so any future loosening forces an explicit
  // test update.
  const validJob = (uid: string) => ({
    bytesB64: "AAAA",
    tape: "18mm",
    status: "queued",
    createdBy: uid,
    createdAt: serverTimestamp(),
    ttlAt: serverTimestamp(),
  })

  it("denies a signed-in non-admin reading a print job", async () => {
    await seedPrintJob("j1")
    await assertCrossUserDenied(
      "printJobs/{id} read leaked to non-admin",
      "firestore.rules: printJobs read",
      () => getDoc(doc(authedDb("alice"), "printJobs", "j1")),
    )
  })

  it("denies a signed-in non-admin creating a print job", async () => {
    await assertCrossUserDenied(
      "printJobs/{id} create leaked to non-admin",
      "firestore.rules: printJobs create",
      () => setDoc(doc(authedDb("alice"), "printJobs", "j-bad"), validJob("alice")),
    )
  })

  it("denies a tag-tap session creating a print job", async () => {
    await assertCrossUserDenied(
      "printJobs/{id} create leaked to tag-tap session",
      "firestore.rules: printJobs create",
      () =>
        setDoc(doc(tagSessionDb("alice"), "printJobs", "j-bad"), validJob("tag:alice:s1")),
    )
  })

  it("denies an anonymous-auth session creating a print job", async () => {
    await assertCrossUserDenied(
      "printJobs/{id} create leaked to anonymous-auth session",
      "firestore.rules: printJobs create",
      () =>
        setDoc(doc(anonAuthDb("anon-x"), "printJobs", "j-bad"), validJob("anon-x")),
    )
  })

  it("denies a fully unauthenticated client reading a print job", async () => {
    await seedPrintJob("j1")
    await assertCrossUserDenied(
      "printJobs/{id} read leaked to unauthenticated session",
      "firestore.rules: printJobs read",
      () => getDoc(doc(unauthDb(), "printJobs", "j1")),
    )
  })

  it("denies an admin updating a job (status writes are gateway-only)", async () => {
    await seedPrintJob("j1")
    await assertCrossUserDenied(
      "printJobs/{id} update reachable from client (must be gateway/SA-only)",
      "firestore.rules: printJobs update deny",
      () => updateDoc(doc(adminDb(), "printJobs", "j1"), { status: "done" }),
    )
  })

  it("denies an admin deleting a job (cleanup is via TTL)", async () => {
    await seedPrintJob("j1")
    await assertCrossUserDenied(
      "printJobs/{id} delete reachable from client (must be TTL-only)",
      "firestore.rules: printJobs delete deny",
      () => deleteDoc(doc(adminDb(), "printJobs", "j1")),
    )
  })

  it("denies an admin creating a job with status != queued", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "printJobs", "j-bad"), {
        ...validJob("admin-test"),
        status: "done",
      }),
    )
  })

  it("denies an admin forging createdBy as another uid", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "printJobs", "j-bad"), validJob("someone-else")),
    )
  })

  // Positive carve-outs
  it("allows an admin enqueuing a queued job", async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), "printJobs", "j-ok"), validJob("admin-test")),
    )
  })

  it("allows an admin reading a print job", async () => {
    await seedPrintJob("j1")
    await assertSucceeds(getDoc(doc(adminDb(), "printJobs", "j1")))
  })
})

describe("cross-user: family-roster join on users", () => {
  it("allows family co-members to read each other's user docs", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await seedMembership("m1", "alice", "family", ["alice", "bob"])
    // Bob can now read Alice's user doc via the family-roster join.
    await assertSucceeds(getDoc(doc(authedDb("bob"), "users", "alice")))
  })

  // Issue #654: the join is evaluated on the *pointers*, not on
  // `members[]`. A callable that appends to `members[]` but leaves
  // `activeMembership` to the async trigger opens a window in which the
  // roster listeners on both sides are denied — and SDK listener errors
  // are terminal. This pins down why acceptFamilyInvite must write the
  // pointer in the same transaction as `members[]`.
  it("denies a joiner in members[] whose activeMembership pointer is still null", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await seedMembership("m1", "alice", "family", ["alice", "bob"])
    await getAdminFirestore()
      .collection("users")
      .doc("bob")
      .update({ activeMembership: null })
    // Joiner side: bob cannot read the owner ...
    await assertCrossUserDenied(
      "users/{id} read granted on members[] alone (joiner side)",
      "firestore.rules: shareActiveMembership join",
      () => getDoc(doc(authedDb("bob"), "users", "alice")),
    )
    // ... and owner side: alice cannot read the joiner either.
    await assertCrossUserDenied(
      "users/{id} read granted on members[] alone (owner side)",
      "firestore.rules: shareActiveMembership join",
      () => getDoc(doc(authedDb("alice"), "users", "bob")),
    )
  })

  it("denies non-co-member reading another user's doc", async () => {
    await seedUser("alice")
    await seedUser("carol")
    // Carol shares no membership with Alice.
    await seedMembership("m1", "alice", "single", ["alice"])
    await assertCrossUserDenied(
      "users/{id} read via family-roster denied for unrelated user",
      "firestore.rules: shareActiveMembership join",
      () => getDoc(doc(authedDb("carol"), "users", "alice")),
    )
  })

  it("denies reading user doc when neither has a membership", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await assertCrossUserDenied(
      "users/{id} read denied when no shared membership",
      "firestore.rules: shareActiveMembership join",
      () => getDoc(doc(authedDb("bob"), "users", "alice")),
    )
  })

  // Issue #422: the same family-roster join is honoured for a kiosk
  // tag-tap session via shareActiveMembershipActingAs — so a tapped user
  // can resolve their co-members' display names for the quick-add chips.
  it("allows tag-tap-as-bob reading a family co-member's user doc (issue #422)", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await seedMembership("m1", "alice", "family", ["alice", "bob"])
    await assertSucceeds(getDoc(doc(tagSessionDb("bob"), "users", "alice")))
  })

  it("denies tag-tap-as-bob reading a non-co-member's user doc (boundary intact, #422)", async () => {
    await seedUser("alice")
    await seedUser("bob")
    // Bob shares no membership with Alice.
    await seedMembership("m1", "alice", "single", ["alice"])
    await assertCrossUserDenied(
      "users/{id} read via family-roster denied for unrelated tag-tap session",
      "firestore.rules: shareActiveMembershipActingAs join",
      () => getDoc(doc(tagSessionDb("bob"), "users", "alice")),
    )
  })

  it("denies a tag-tap session updating a co-member's user doc (mutation boundary intact, #422)", async () => {
    await seedUser("alice")
    await seedUser("bob")
    await seedMembership("m1", "alice", "family", ["alice", "bob"])
    // Read is allowed (above), but a synthetic session must never mutate a
    // co-member's user doc — write stays scoped to userId == request.auth.uid.
    await assertCrossUserDenied(
      "users/{id} update leaked to tag-tap co-member session",
      "firestore.rules: users update",
      () =>
        updateDoc(doc(tagSessionDb("bob"), "users", "alice"), {
          firstName: "pwned",
        }),
    )
  })
})

// Issue #745: `activeMembership` grants member prices, the Sammelrechnung,
// a free first badge and the family-roster read (shareActiveMembership).
// Only the server (Admin SDK) maintains it; no client principal but an
// admin may set, change or clear it.
describe("cross-user: activeMembership is server-only", () => {
  const RULE = "firestore.rules users create/update (activeMembershipUnchanged, #745)"

  function profile(uid: string, extra: Record<string, unknown> = {}) {
    return {
      firstName: "Self",
      lastName: uid,
      email: `${uid}@test.com`,
      roles: [],
      permissions: [],
      userType: "erwachsen",
      ...extra,
    }
  }

  function ownerDb(uid: string) {
    return getTestEnvironment()
      .authenticatedContext(uid, { email: `${uid}@test.com` })
      .firestore()
  }

  it("denies the owner creating their doc with a pointer", async () => {
    await seedMembership("m-victim", "victim", "family", ["victim"])
    const db = ownerDb("mallory")
    await assertCrossUserDenied(
      "users/{userId} create with activeMembership",
      RULE,
      () =>
        setDoc(
          doc(db, "users", "mallory"),
          profile("mallory", { activeMembership: doc(db, "memberships", "m-victim") }),
        ),
    )
  })

  it("allows the owner creating their doc with a null or absent pointer", async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb("mallory"), "users", "mallory"), profile("mallory", { activeMembership: null })),
    )
    await assertSucceeds(
      setDoc(doc(ownerDb("trent"), "users", "trent"), profile("trent")),
    )
  })

  it("denies the owner setting a pointer on update", async () => {
    await seedUser("mallory")
    await seedMembership("m-victim", "victim", "family", ["victim"])
    const db = authedDb("mallory")
    await assertCrossUserDenied(
      "users/{userId} update sets activeMembership",
      RULE,
      () => updateDoc(doc(db, "users", "mallory"), { activeMembership: doc(db, "memberships", "m-victim") }),
    )
  })

  it("denies the owner changing or clearing their pointer", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice", "single", ["alice"])
    await seedMembership("m-victim", "victim", "family", ["victim"])
    const db = authedDb("alice")
    await assertCrossUserDenied(
      "users/{userId} update changes activeMembership",
      RULE,
      () => updateDoc(doc(db, "users", "alice"), { activeMembership: doc(db, "memberships", "m-victim") }),
    )
    await assertCrossUserDenied(
      "users/{userId} update clears activeMembership",
      RULE,
      () => updateDoc(doc(db, "users", "alice"), { activeMembership: null }),
    )
  })

  it("allows the owner editing other fields while the pointer stays", async () => {
    await seedUser("alice")
    await seedMembership("m1", "alice", "single", ["alice"])
    await assertSucceeds(updateDoc(doc(authedDb("alice"), "users", "alice"), { firstName: "Alicia" }))
  })

  it("denies an elevated kiosk session setting, changing or clearing the pointer", async () => {
    await seedUser("mallory")
    await seedUser("alice")
    await seedMembership("m1", "alice", "single", ["alice"])
    await seedMembership("m-victim", "victim", "family", ["victim"])
    const malloryDb = elevatedTagSessionDb("mallory")
    await assertCrossUserDenied(
      "users/{userId} elevated kiosk update sets activeMembership",
      RULE,
      () => updateDoc(doc(malloryDb, "users", "mallory"), { activeMembership: doc(malloryDb, "memberships", "m-victim") }),
    )
    const aliceDb = elevatedTagSessionDb("alice")
    await assertCrossUserDenied(
      "users/{userId} elevated kiosk update changes activeMembership",
      RULE,
      () => updateDoc(doc(aliceDb, "users", "alice"), { activeMembership: doc(aliceDb, "memberships", "m-victim") }),
    )
    await assertCrossUserDenied(
      "users/{userId} elevated kiosk update clears activeMembership",
      RULE,
      () => updateDoc(doc(aliceDb, "users", "alice"), { activeMembership: null }),
    )
  })

  it("allows an admin setting the pointer", async () => {
    await seedUser("alice")
    await seedMembership("m2", "bob", "family", ["bob"])
    const db = adminDb()
    await assertSucceeds(updateDoc(doc(db, "users", "alice"), { activeMembership: doc(db, "memberships", "m2") }))
  })
})

describe("cross-user: device status (admin read only, ADR-0045)", () => {
  // Status docs are machine-written by the functions (Admin SDK) from the
  // gateway/kiosk reports. Nobody writes them through the rules, and only
  // admins read them — directly or as the "status" collection group.
  async function seedStatus(kind: string, id: string) {
    await getAdminFirestore()
      .collection(kind)
      .doc(id)
      .collection("status")
      .doc("current")
      .set({ version: "2026.10.3", online: true })
  }

  it("lets an admin read a terminal's status and the status collection group", async () => {
    await seedStatus("maco", "0a10aced202194944a042f04")
    await seedStatus("gateways", "workshop")
    await assertSucceeds(
      getDoc(doc(adminDb(), "maco", "0a10aced202194944a042f04", "status", "current")),
    )
    await assertSucceeds(getDocs(collectionGroup(adminDb(), "status")))
  })

  it("denies a signed-in non-admin reading status", async () => {
    await seedStatus("gateways", "workshop")
    await assertCrossUserDenied(
      "gateways/{id}/status read leaked to non-admin",
      "firestore.rules: device status read",
      () => getDoc(doc(authedDb("alice"), "gateways", "workshop", "status", "current")),
    )
    await assertCrossUserDenied(
      "status collection group leaked to non-admin",
      "firestore.rules: device status collection group",
      () => getDocs(collectionGroup(authedDb("alice"), "status")),
    )
  })

  it("denies a kiosk tag-tap session reading status", async () => {
    await seedStatus("kiosks", "checkout")
    await assertCrossUserDenied(
      "kiosks/{id}/status read leaked to tag-tap session",
      "firestore.rules: device status read",
      () => getDoc(doc(tagSessionDb("alice"), "kiosks", "checkout", "status", "current")),
    )
  })

  it("denies writes even to an admin — only the functions write status", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "maco", "0a10aced202194944a042f04", "status", "current"), {
        online: false,
      }),
    )
  })
})

// Issue #605 (ADR-0050): companions the account holder saved for the next
// check-in. Owner-scoped third-party data — the same matrix as every other
// owner-scoped collection, plus the create allowlist and "no update".
describe("cross-user: savedPersons", () => {
  const RULE = "firestore.rules:users/{userId}/savedPersons"
  const validPerson = (uid: string) => ({
    firstName: "Kim",
    lastName: "Muster",
    userType: "kind",
    createdAt: serverTimestamp(),
    modifiedBy: uid,
    modifiedAt: serverTimestamp(),
  })

  async function seedSavedPerson(ownerUid: string, id = "sp1") {
    const db = getAdminFirestore()
    await db.doc(`users/${ownerUid}/savedPersons/${id}`).set({
      firstName: "Kim",
      lastName: "Muster",
      userType: "kind",
      createdAt: FieldValue.serverTimestamp(),
      modifiedBy: ownerUid,
      modifiedAt: FieldValue.serverTimestamp(),
    })
  }

  it("denies bob reading alice's saved person", async () => {
    await seedSavedPerson("alice")
    await assertCrossUserDenied(
      "savedPersons read leaked to another user",
      RULE,
      () => getDoc(doc(authedDb("bob"), "users/alice/savedPersons/sp1")),
    )
  })

  it("denies bob listing alice's saved persons", async () => {
    await seedSavedPerson("alice")
    await assertCrossUserDenied(
      "savedPersons list leaked to another user",
      RULE,
      () => getDocs(collection(authedDb("bob"), "users/alice/savedPersons")),
    )
  })

  it("denies bob creating a saved person under alice", async () => {
    await assertCrossUserDenied(
      "savedPersons create allowed for another user",
      RULE,
      () => setDoc(doc(authedDb("bob"), "users/alice/savedPersons/sp9"), validPerson("bob")),
    )
  })

  it("denies bob deleting alice's saved person", async () => {
    await seedSavedPerson("alice")
    await assertCrossUserDenied(
      "savedPersons delete allowed for another user",
      RULE,
      () => deleteDoc(doc(authedDb("bob"), "users/alice/savedPersons/sp1")),
    )
  })

  it("denies tag-tap-as-bob reading alice's saved person", async () => {
    await seedSavedPerson("alice")
    await assertCrossUserDenied(
      "savedPersons read leaked across tag-tap actsAs",
      RULE,
      () => getDoc(doc(tagSessionDb("bob"), "users/alice/savedPersons/sp1")),
    )
  })

  it("denies anonymous-auth and unauthenticated reads", async () => {
    await seedSavedPerson("alice")
    await assertCrossUserDenied(
      "savedPersons read leaked to anonymous-auth session",
      RULE,
      () => getDoc(doc(anonAuthDb("anon-x"), "users/alice/savedPersons/sp1")),
    )
    await assertCrossUserDenied(
      "savedPersons read leaked to unauthenticated session",
      RULE,
      () => getDoc(doc(unauthDb(), "users/alice/savedPersons/sp1")),
    )
  })

  // Positive carve-outs
  it("allows alice reading, listing, creating and deleting her own", async () => {
    await seedSavedPerson("alice")
    const db = authedDb("alice")
    await assertSucceeds(getDoc(doc(db, "users/alice/savedPersons/sp1")))
    await assertSucceeds(getDocs(collection(db, "users/alice/savedPersons")))
    await assertSucceeds(setDoc(doc(db, "users/alice/savedPersons/sp2"), validPerson("alice")))
    await assertSucceeds(deleteDoc(doc(db, "users/alice/savedPersons/sp1")))
  })

  it("allows a plain badge session acting as alice to read, create and delete", async () => {
    await seedSavedPerson("alice")
    const db = tagSessionDb("alice")
    await assertSucceeds(getDoc(doc(db, "users/alice/savedPersons/sp1")))
    await assertSucceeds(getDocs(collection(db, "users/alice/savedPersons")))
    await assertSucceeds(
      setDoc(doc(db, "users/alice/savedPersons/sp2"), validPerson("tag:alice:s1")),
    )
    await assertSucceeds(deleteDoc(doc(db, "users/alice/savedPersons/sp1")))
  })

  it("allows admin reading", async () => {
    await seedSavedPerson("alice")
    await assertSucceeds(getDoc(doc(adminDb(), "users/alice/savedPersons/sp1")))
  })

  // Shape
  it("denies updates, even by the owner", async () => {
    await seedSavedPerson("alice")
    await assertCrossUserDenied(
      "savedPersons update allowed (create + delete only)",
      RULE,
      () => updateDoc(doc(authedDb("alice"), "users/alice/savedPersons/sp1"), { firstName: "Kai" }),
    )
  })

  it("denies extra keys — the usage type is never saved", async () => {
    await assertCrossUserDenied(
      "savedPersons create accepted a key outside the allowlist",
      RULE,
      () =>
        setDoc(doc(authedDb("alice"), "users/alice/savedPersons/sp2"), {
          ...validPerson("alice"),
          usageType: "materialbezug",
        }),
    )
  })

  it("denies a company or an empty name", async () => {
    await assertCrossUserDenied(
      "savedPersons create accepted userType firma",
      RULE,
      () =>
        setDoc(doc(authedDb("alice"), "users/alice/savedPersons/sp2"), {
          ...validPerson("alice"),
          userType: "firma",
        }),
    )
    await assertCrossUserDenied(
      "savedPersons create accepted an empty first name",
      RULE,
      () =>
        setDoc(doc(authedDb("alice"), "users/alice/savedPersons/sp3"), {
          ...validPerson("alice"),
          firstName: "",
        }),
    )
  })
})
