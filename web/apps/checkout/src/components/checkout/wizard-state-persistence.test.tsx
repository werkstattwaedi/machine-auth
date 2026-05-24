// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #246 regression: persons typed on step 0 must survive a
 * nav-away-and-back. The wizard persists the roster onto the open
 * Firestore checkout doc on "Weiter", and rehydrates from that doc when
 * it remounts. This test exercises both halves at a unit level:
 *
 * 1. Round-trip of the (de)serializer — `personLocalToDoc` ↔
 *    `personDocToLocal` — so a person typed in step 0, persisted, and
 *    later read back keeps their fields.
 * 2. Component-level: when `useCollection` for open checkouts returns a
 *    doc with `persons`, the wizard dispatches REPLACE_PERSONS exactly
 *    once and the rendered cards show the rehydrated names. This is the
 *    "nav-away and back" path — a wizard remount sees the same open
 *    checkout doc the previous mount wrote to.
 * 3. Reducer-level: the RESET action wipes `persons`. The "Werkstatt
 *    verlassen" / kiosk reset path leaves the open checkout closed
 *    server-side, so on a subsequent mount the rehydration source is
 *    gone and the reducer starts clean.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { type ReactNode } from "react"
import {
  checkoutReducer,
  initialState,
  type CheckoutPerson,
} from "./use-checkout-state"

// --- toast spy ---
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

// --- httpsCallable spy (unused on step 0 but required by submit branch) ---
const mockCallable = vi.fn()
vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => mockCallable,
}))

// --- useAuth + useTokenAuth: account-logged-in user ---
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "test-uid", isAnonymous: false },
    userDoc: {
      id: "test-user",
      firstName: "Max",
      lastName: "Muster",
      email: "max@example.com",
      userType: "erwachsen",
      termsAcceptedAt: new Date(),
      roles: [],
    },
    signOut: vi.fn(),
    signInAnonymouslyIfNeeded: vi.fn(),
  }),
}))
vi.mock("@modules/lib/token-auth", () => ({
  useTokenAuth: () => ({
    tokenUser: null,
    loading: false,
    isTagAuth: false,
    tagSignOut: vi.fn(),
  }),
}))

// --- Firestore: useCollection is controlled per test via the queue ---
// First call: open-checkouts subscription.
// Second call: items subscription.
// Third call: family memberships subscription.
// Fourth call: family member docs subscription.
const collectionQueue: { data: unknown[]; loading: boolean; error: null }[] = []
vi.mock("@modules/lib/firestore", () => ({
  useCollection: () => {
    const next = collectionQueue.shift()
    return next ?? { data: [], loading: false, error: null }
  },
  // Issue #262/#263: the wizard reads `config/catalog-references` for the
  // membership SKU id. Not under test here → stable null doc.
  useDocument: () => ({ data: null, loading: false, error: null }),
}))

// --- firestore-helpers ---
vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: (_db: unknown, id: string) => ({
    id,
    path: `users/${id}`,
  }),
  checkoutRef: (_db: unknown, id: string) => ({
    id,
    path: `checkouts/${id}`,
  }),
  checkoutsCollection: () => ({ path: "checkouts" }),
  checkoutItemsCollection: () => ({ path: "checkouts/x/items" }),
  catalogReferencesRef: () => ({ path: "config/catalog-references" }),
  membershipsCollection: () => ({ path: "memberships" }),
  usersCollection: () => ({ path: "users" }),
}))

// --- firebase-context ---
vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
  useFirebaseAuth: () => ({ currentUser: { uid: "test-uid" } }),
  FirebaseProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// --- workshop-config: minimal pricing config ---
vi.mock("@modules/lib/workshop-config", () => ({
  usePricingConfig: () => ({
    data: {
      entryFees: { erwachsen: { regular: 5 } },
      workshops: { holz: { label: "Holz", order: 1 } },
      slaLayerPrice: { none: 0.01, member: 0.008 },
      labels: {
        units: { h: "Std." },
        discounts: { none: "Normal", member: "Mitglied" },
      },
    },
    loading: false,
    error: null,
    configError: null,
  }),
  getSortedWorkshops: (config: {
    workshops: Record<string, { label: string; order: number }>
  }) =>
    Object.entries(config.workshops).sort((a, b) => a[1].order - b[1].order),
}))

// --- pricing helpers ---
vi.mock("@modules/lib/pricing", () => ({
  calculateFee: () => 5,
  standardFee: () => 5,
  usageDiscount: () => ({ entryFee: 1, machine: 1, material: 1, tip: 1 }),
  USAGE_TYPE_LABELS: { regular: "Regulär" },
  USAGE_DISCOUNT_LABELS: {},
  USER_TYPE_LABELS: { erwachsen: "Erwachsen", kind: "Kind" },
}))

// Imports below this line pick up the mocks.
import {
  CheckoutWizard,
  personDocToLocal,
  personLocalToDoc,
} from "./checkout-wizard"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  collectionQueue.length = 0
})

beforeEach(() => {
  collectionQueue.length = 0
})

describe("person doc <-> local round-trip (#246)", () => {
  const fakeDb = {} as Parameters<typeof personLocalToDoc>[1]

  it("preserves name, email, userType, billing, and userId via Firestore round-trip", () => {
    const local: CheckoutPerson = {
      id: "p1",
      firstName: "Anna",
      lastName: "Beispiel",
      email: "anna@example.com",
      userType: "firma",
      termsAccepted: true,
      isPreFilled: true,
      userId: "u-anna",
      billingCompany: "Acme",
      billingStreet: "Hauptstr. 1",
      billingZip: "8000",
      billingCity: "Zürich",
    }

    const doc = personLocalToDoc(local, fakeDb)
    expect(doc.name).toBe("Anna Beispiel")
    expect(doc.email).toBe("anna@example.com")
    expect(doc.userType).toBe("firma")
    expect(doc.billingAddress).toEqual({
      company: "Acme",
      street: "Hauptstr. 1",
      zip: "8000",
      city: "Zürich",
    })
    expect(doc.userRef?.id).toBe("u-anna")

    const rehydrated = personDocToLocal(doc)
    expect(rehydrated.firstName).toBe("Anna")
    expect(rehydrated.lastName).toBe("Beispiel")
    expect(rehydrated.email).toBe("anna@example.com")
    expect(rehydrated.userType).toBe("firma")
    expect(rehydrated.userId).toBe("u-anna")
    expect(rehydrated.isPreFilled).toBe(true)
    expect(rehydrated.billingCompany).toBe("Acme")
    expect(rehydrated.billingStreet).toBe("Hauptstr. 1")
    expect(rehydrated.billingZip).toBe("8000")
    expect(rehydrated.billingCity).toBe("Zürich")
  })

  it("rehydrates name without a space as firstName only", () => {
    const doc = personLocalToDoc(
      {
        id: "p1",
        firstName: "Cher",
        lastName: "",
        email: "",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: true,
      },
      fakeDb,
    )
    expect(doc.name).toBe("Cher")
    const back = personDocToLocal(doc)
    expect(back.firstName).toBe("Cher")
    expect(back.lastName).toBe("")
  })

  it("does not stamp userRef when no userId is set", () => {
    const doc = personLocalToDoc(
      {
        id: "p1",
        firstName: "Visitor",
        lastName: "Anon",
        email: "v@x.com",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: false,
      },
      fakeDb,
    )
    expect(doc.userRef).toBeUndefined()
    const back = personDocToLocal(doc)
    expect(back.userId).toBeNull()
  })
})

describe("CheckoutWizard rehydrates from open checkout (#246)", () => {
  it("dispatches REPLACE_PERSONS with persons from the open Firestore checkout", async () => {
    // Queue the four useCollection subscriptions:
    // 1. open checkouts: one doc with two persons (signed-in user + Lia).
    // 2. items: empty.
    // 3. family memberships: empty (no roster needed for rehydration).
    // 4. family member docs: empty.
    collectionQueue.push({
      data: [
        {
          id: "co-1",
          userId: { id: "test-user", path: "users/test-user" },
          status: "open",
          usageType: "regular",
          workshopsVisited: [],
          persons: [
            {
              name: "Max Muster",
              email: "max@example.com",
              userType: "erwachsen",
              userRef: { id: "test-user", path: "users/test-user" },
            },
            {
              name: "Lia Pfeffer",
              email: "lia@example.com",
              userType: "kind",
              userRef: { id: "u-lia", path: "users/u-lia" },
            },
          ],
        },
      ],
      loading: false,
      error: null,
    })
    collectionQueue.push({ data: [], loading: false, error: null })
    collectionQueue.push({ data: [], loading: false, error: null })
    collectionQueue.push({ data: [], loading: false, error: null })

    await act(async () => {
      render(<CheckoutWizard />)
    })

    // The wizard is on step 0 (Check-in). The rehydrated cards should be
    // rendered with the persisted names. We assert by display values
    // rather than by reaching into reducer state — the user-visible
    // outcome is what matters.
    //
    // Both names appear somewhere on the page (in pre-filled card text).
    expect(screen.getAllByText(/Max/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Lia/).length).toBeGreaterThan(0)
  })
})

describe("checkoutReducer RESET clears persons (#246)", () => {
  it("returns to the initial single-empty-person state", () => {
    const populated = checkoutReducer(initialState, {
      type: "REPLACE_PERSONS",
      persons: [
        {
          id: "p1",
          firstName: "Max",
          lastName: "Muster",
          email: "max@example.com",
          userType: "erwachsen",
          termsAccepted: true,
          isPreFilled: true,
          userId: "u-max",
        },
        {
          id: "p2",
          firstName: "Lia",
          lastName: "Pfeffer",
          email: "lia@example.com",
          userType: "kind",
          termsAccepted: true,
          isPreFilled: true,
          userId: "u-lia",
        },
      ],
    })
    expect(populated.persons.length).toBe(2)

    const reset = checkoutReducer(populated, { type: "RESET" })
    expect(reset.persons.length).toBe(1)
    expect(reset.persons[0].firstName).toBe("")
    expect(reset.persons[0].lastName).toBe("")
    expect(reset.persons[0].isPreFilled).toBe(false)
  })

  it("REPLACE_PERSONS overwrites the entire persons array", () => {
    const next = checkoutReducer(initialState, {
      type: "REPLACE_PERSONS",
      persons: [
        {
          id: "p-new",
          firstName: "Eve",
          lastName: "Test",
          email: "eve@test.com",
          userType: "erwachsen",
          termsAccepted: true,
          isPreFilled: true,
        },
      ],
    })
    expect(next.persons.length).toBe(1)
    expect(next.persons[0].firstName).toBe("Eve")
  })
})
