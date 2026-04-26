// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #145: the canonical Firestore access pattern.
 *
 * Verifies the contract that the rest of the codebase relies on:
 *   - The hooks (`useDocument`, `useCollection`) accept typed
 *     `DocumentReference<T>` / `CollectionReference<T>` from `firestore-helpers`
 *     — never raw string paths.
 *   - The mutation API (`useFirestoreMutation`) accepts the same typed refs
 *     and stamps audit fields on every write.
 *   - The typed builders return refs whose `path` matches the canonical
 *     schema in `firestore/schema.jsonc`.
 *
 * These tests are the safety net that lets us delete the old string-path
 * overloads with confidence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import type {
  CollectionReference,
  DocumentReference,
} from "firebase/firestore"
import { useCollection, useDocument } from "./firestore"
import { useFirestoreMutation } from "../hooks/use-firestore-mutation"
import {
  FirebaseProvider,
  type FirebaseServices,
} from "./firebase-context"
import { FakeFirestore } from "../test/fake-firestore"

// ── Module-level mocks ───────────────────────────────────────────────────

vi.mock("./auth", () => ({
  useAuth: () => ({
    user: { uid: "test-user" },
    userDoc: null,
    isAdmin: false,
    loading: false,
    userDocLoading: false,
  }),
}))

vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "test-user" },
    userDoc: null,
    isAdmin: false,
    loading: false,
    userDocLoading: false,
  }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => () => Promise.resolve({ data: { ok: true } }),
}))

let fakeDb: FakeFirestore

// Bridge the firebase/firestore SDK to FakeFirestore. The hooks now accept
// typed refs directly — we mock `collection()` and `doc()` so the canonical
// builders in `firestore-helpers.ts` route to FakeFirestore at the seam.
vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>(
    "firebase/firestore",
  )
  return {
    ...actual,
    collection: (_db: unknown, ...segments: string[]) =>
      fakeDb.collection(segments.join("/")),
    doc: (_db: unknown, ...segments: string[]) => fakeDb.doc(...segments),
    query: (_ref: unknown, ...constraints: unknown[]) => {
      const ref = _ref as { path: string }
      return {
        type: "query",
        collectionPath: ref.path,
        path: ref.path,
        constraints: constraints as { kind: string }[],
      }
    },
    onSnapshot: (
      refOrQuery: {
        type: string
        path?: string
        collectionPath?: string
        constraints?: unknown[]
      },
      onNext: (snap: unknown) => void,
    ) => {
      if (refOrQuery.type === "document") {
        return fakeDb.onSnapshotDoc(
          refOrQuery as ReturnType<FakeFirestore["doc"]>,
          onNext as Parameters<FakeFirestore["onSnapshotDoc"]>[1],
        )
      }
      const path = refOrQuery.collectionPath ?? refOrQuery.path ?? ""
      const constraints = refOrQuery.constraints ?? []
      return fakeDb.onSnapshotCollection(
        fakeDb.collection(path),
        constraints as Parameters<FakeFirestore["onSnapshotCollection"]>[1],
        onNext as Parameters<FakeFirestore["onSnapshotCollection"]>[2],
      )
    },
    setDoc: (
      ref: ReturnType<FakeFirestore["doc"]>,
      data: Record<string, unknown>,
    ) => {
      fakeDb.setDoc(ref, data)
      return Promise.resolve()
    },
    addDoc: (
      colRef: ReturnType<FakeFirestore["collection"]>,
      data: Record<string, unknown>,
    ) => {
      const ref = fakeDb.addDoc(colRef, data)
      return Promise.resolve(ref)
    },
    updateDoc: (
      ref: ReturnType<FakeFirestore["doc"]>,
      data: Record<string, unknown>,
    ) => {
      fakeDb.updateDoc(ref, data)
      return Promise.resolve()
    },
    deleteDoc: (ref: ReturnType<FakeFirestore["doc"]>) => {
      fakeDb.deleteDoc(ref)
      return Promise.resolve()
    },
    serverTimestamp: () => ({ _fake: "serverTimestamp" }),
  }
})

// ── Imports that depend on the mocked SDK ────────────────────────────────

import {
  userRef,
  usersCollection,
  permissionRef,
  permissionsCollection,
  catalogRef,
  catalogCollection,
  checkoutRef,
  checkoutsCollection,
  checkoutItemRef,
  checkoutItemsCollection,
  machineRef,
  machinesCollection,
  macoRef,
  tokenRef,
  tokensCollection,
  priceListRef,
  priceListsCollection,
  billRef,
  billsCollection,
  configRef,
  usageMachineRef,
  usageMachineCollection,
  auditLogCollection,
  operationsLogCollection,
} from "./firestore-helpers"

// ── Test scaffolding ─────────────────────────────────────────────────────

function createWrapper() {
  const services: FirebaseServices = {
    db: { app: {} } as unknown as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return ({ children }: { children: ReactNode }) => (
    <FirebaseProvider value={services}>{children}</FirebaseProvider>
  )
}

const fakeFirestoreDb = {} as unknown as import("firebase/firestore").Firestore

// ── Builder path coverage ────────────────────────────────────────────────

describe("typed ref builders match the canonical schema", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
  })

  it.each([
    [() => userRef(fakeFirestoreDb, "u1"), "users/u1"],
    [() => usersCollection(fakeFirestoreDb), "users"],
    [() => permissionRef(fakeFirestoreDb, "laser"), "permission/laser"],
    [() => permissionsCollection(fakeFirestoreDb), "permission"],
    [() => catalogRef(fakeFirestoreDb, "c1"), "catalog/c1"],
    [() => catalogCollection(fakeFirestoreDb), "catalog"],
    [() => checkoutRef(fakeFirestoreDb, "co1"), "checkouts/co1"],
    [() => checkoutsCollection(fakeFirestoreDb), "checkouts"],
    [
      () => checkoutItemRef(fakeFirestoreDb, "co1", "item1"),
      "checkouts/co1/items/item1",
    ],
    [
      () => checkoutItemsCollection(fakeFirestoreDb, "co1"),
      "checkouts/co1/items",
    ],
    [() => machineRef(fakeFirestoreDb, "m1"), "machine/m1"],
    [() => machinesCollection(fakeFirestoreDb), "machine"],
    [() => macoRef(fakeFirestoreDb, "term1"), "maco/term1"],
    [() => tokenRef(fakeFirestoreDb, "uid1"), "tokens/uid1"],
    [() => tokensCollection(fakeFirestoreDb), "tokens"],
    [() => priceListRef(fakeFirestoreDb, "pl1"), "price_lists/pl1"],
    [() => priceListsCollection(fakeFirestoreDb), "price_lists"],
    [() => billRef(fakeFirestoreDb, "b1"), "bills/b1"],
    [() => billsCollection(fakeFirestoreDb), "bills"],
    [() => configRef(fakeFirestoreDb, "pricing"), "config/pricing"],
    [() => usageMachineRef(fakeFirestoreDb, "u1"), "usage_machine/u1"],
    [() => usageMachineCollection(fakeFirestoreDb), "usage_machine"],
    [() => auditLogCollection(fakeFirestoreDb), "audit_log"],
    [() => operationsLogCollection(fakeFirestoreDb), "operations_log"],
  ])("builds the right path", (build, expected) => {
    expect((build() as { path: string }).path).toBe(expected)
  })
})

// ── End-to-end: hooks accept typed refs ─────────────────────────────────

describe("hooks accept typed refs", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
    sessionStorage.clear()
  })

  it("useDocument reads through a typed user ref", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), {
      firstName: "Max",
      lastName: "Muster",
      email: "max@test.com",
      roles: ["vereinsmitglied"],
    })

    const { result } = renderHook(
      () => useDocument(userRef(fakeFirestoreDb, "u1")),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toMatchObject({
      id: "u1",
      firstName: "Max",
      email: "max@test.com",
    })
  })

  it("useCollection reads through a typed checkouts collection ref", async () => {
    fakeDb.setDoc(fakeDb.doc("checkouts", "co1"), { status: "open" })
    fakeDb.setDoc(fakeDb.doc("checkouts", "co2"), { status: "closed" })

    const { result } = renderHook(
      () => useCollection(checkoutsCollection(fakeFirestoreDb)),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(2)
  })

  it("subcollection refs resolve to the right path", async () => {
    fakeDb.setDoc(fakeDb.doc("checkouts", "co1", "items", "i1"), {
      description: "Holz",
      totalPrice: 10,
    })

    const { result } = renderHook(
      () => useCollection(checkoutItemsCollection(fakeFirestoreDb, "co1")),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0]).toMatchObject({
      id: "i1",
      description: "Holz",
    })
  })
})

// ── End-to-end: mutations accept typed refs + audit-stamp ───────────────

describe("useFirestoreMutation accepts typed refs and stamps audit fields", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
  })

  it("set writes to the typed ref and stamps audit fields", async () => {
    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.set(permissionRef(fakeFirestoreDb, "laser"), {
        name: "Laser Cutter",
      })
    })

    const data = fakeDb.getData("permission", "laser")
    expect(data?.name).toBe("Laser Cutter")
    expect(data?.modifiedBy).toBe("test-user")
    expect(data?.modifiedAt).toBeInstanceOf(Date)
  })

  it("update writes a DocumentReference field through a typed ref", async () => {
    // Seed the user doc so update has something to merge into.
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { firstName: "Max" })

    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    const permissions = [permissionRef(fakeFirestoreDb, "laser")]
    await act(async () => {
      await result.current.update(userRef(fakeFirestoreDb, "u1"), {
        permissions,
      })
    })

    const data = fakeDb.getData("users", "u1")
    expect(data?.firstName).toBe("Max") // existing field preserved
    const stored = data?.permissions as Array<{ path: string }>
    expect(stored).toHaveLength(1)
    // The DocumentReference round-trips intact (path-stable).
    expect(stored[0].path).toBe("permission/laser")
  })

  it("add creates a doc in the typed collection", async () => {
    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      // Cast the collection ref so the test can pass partial data; the
      // runtime contract being exercised here is "typed ref + data flows
      // through and gets audit-stamped." The CheckoutDoc-level required
      // fields are tested elsewhere.
      type MinimalCheckout = { status: string; usageType: string }
      const ref = checkoutsCollection(
        fakeFirestoreDb,
      ) as unknown as CollectionReference<MinimalCheckout>
      await result.current.add(ref, { status: "open", usageType: "regular" })
    })

    const all = fakeDb.getAllDocs("checkouts")
    expect(all.size).toBe(1)
    const [, data] = [...all.entries()][0]
    expect(data.status).toBe("open")
    expect(data.modifiedBy).toBe("test-user")
  })

  it("remove deletes through the typed ref", async () => {
    fakeDb.setDoc(fakeDb.doc("permission", "laser"), { name: "Laser Cutter" })

    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.remove(permissionRef(fakeFirestoreDb, "laser"))
    })

    expect(fakeDb.getData("permission", "laser")).toBeUndefined()
  })

  it("write-then-read round-trip preserves DocumentReference fields", async () => {
    // Demonstrates the canonical pattern: a write puts a typed
    // `DocumentReference` field into Firestore, a subsequent read
    // surfaces the same ref (path-stable). This is the contract that
    // makes lookup tables (resolveRef) and the rules' get() calls work.

    const { result: mutator } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    // Seed a permission so the user's permissions field has somewhere to
    // point.
    fakeDb.setDoc(fakeDb.doc("permission", "laser"), { name: "Laser Cutter" })

    await act(async () => {
      // Cast through a minimal subtype so the test can skip the rest of
      // the required UserDoc fields; the round-trip we care about is the
      // DocumentReference field on `permissions`.
      type MinimalUser = {
        firstName: string
        permissions: ReturnType<typeof permissionRef>[]
      }
      const ref = userRef(
        fakeFirestoreDb,
        "u1",
      ) as unknown as DocumentReference<MinimalUser>
      await mutator.current.set(ref, {
        firstName: "Max",
        permissions: [permissionRef(fakeFirestoreDb, "laser")],
      })
    })

    const { result: reader } = renderHook(
      () => useDocument(userRef(fakeFirestoreDb, "u1")),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(reader.current.loading).toBe(false))
    const stored = reader.current.data?.permissions as Array<{ path: string }>
    expect(stored).toHaveLength(1)
    expect(stored[0].path).toBe("permission/laser")
  })
})
