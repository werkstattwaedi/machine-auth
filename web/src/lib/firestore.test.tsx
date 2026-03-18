// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { useCollection, useDocument } from "./firestore"
import { FirebaseProvider, type FirebaseServices } from "./firebase-context"
import { FakeFirestore } from "@/test/fake-firestore"

/**
 * The real useCollection/useDocument hooks call Firebase SDK functions
 * (collection, doc, onSnapshot, query) that expect a real Firestore instance.
 *
 * To test them with FakeFirestore, we mock the firebase/firestore module
 * to redirect these SDK calls to our fake. This is a bridge layer —
 * the hooks themselves are under test, not the Firebase SDK.
 */

let fakeDb: FakeFirestore

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore")
  return {
    ...actual,
    collection: (...args: unknown[]) => {
      // collection(db, path) — db is from context, path is a string
      const path = args[1] as string
      return fakeDb.collection(path)
    },
    doc: (...args: unknown[]) => {
      // doc(db, path) or doc(db, path, id, ...)
      const segments = (args as unknown[]).slice(1) as string[]
      return fakeDb.doc(...segments)
    },
    query: (_ref: unknown, ...constraints: unknown[]) => {
      // query(collectionRef, ...constraints)
      const ref = _ref as { path: string }
      return {
        type: "query",
        collectionPath: ref.path,
        constraints: constraints as { kind: string }[],
      }
    },
    onSnapshot: (
      refOrQuery: { type: string; path?: string; collectionPath?: string; constraints?: unknown[] },
      onNext: (snap: unknown) => void,
      onError?: (err: Error) => void,
    ) => {
      try {
        if (refOrQuery.type === "document") {
          return fakeDb.onSnapshotDoc(
            refOrQuery as ReturnType<FakeFirestore["doc"]>,
            onNext as Parameters<FakeFirestore["onSnapshotDoc"]>[1],
          )
        }
        // Collection or query
        const path = refOrQuery.collectionPath ?? refOrQuery.path ?? ""
        const constraints = (refOrQuery as { constraints?: unknown[] }).constraints ?? []
        return fakeDb.onSnapshotCollection(
          fakeDb.collection(path),
          constraints as Parameters<FakeFirestore["onSnapshotCollection"]>[1],
          onNext as Parameters<FakeFirestore["onSnapshotCollection"]>[2],
        )
      } catch (err) {
        onError?.(err as Error)
        return () => {}
      }
    },
    where: (field: string, op: string, value: unknown) => ({
      kind: "where",
      field,
      op,
      value,
    }),
    orderBy: (field: string, direction: string = "asc") => ({
      kind: "orderBy",
      field,
      direction,
    }),
    limit: (count: number) => ({
      kind: "limit",
      count,
    }),
  }
})

function createWrapper() {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"], // placeholder — hooks use mocked SDK
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return ({ children }: { children: ReactNode }) => (
    <FirebaseProvider value={services}>{children}</FirebaseProvider>
  )
}

describe("useCollection", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
  })

  it("returns empty array initially for empty collection", async () => {
    const { result } = renderHook(() => useCollection("users"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it("returns documents with id field", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })
    fakeDb.setDoc(fakeDb.doc("users", "u2"), { name: "Anna" })

    const { result } = renderHook(() => useCollection("users"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0]).toMatchObject({ id: "u1", name: "Max" })
    expect(result.current.data[1]).toMatchObject({ id: "u2", name: "Anna" })
  })

  it("returns empty for null path", async () => {
    const { result } = renderHook(() => useCollection(null), {
      wrapper: createWrapper(),
    })

    // Should resolve immediately (no delay) for null path
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual([])
  })

  it("reacts to data changes", async () => {
    const { result } = renderHook(() => useCollection("users"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(0)

    act(() => {
      fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })
    })

    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data[0]).toMatchObject({ id: "u1", name: "Max" })
  })

  it("applies where constraints", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max", role: "admin" })
    fakeDb.setDoc(fakeDb.doc("users", "u2"), { name: "Anna", role: "member" })

    // We need to import where from the mocked module
    const { where } = await import("firebase/firestore")
    const { result } = renderHook(
      () => useCollection("users", where("role", "==", "admin")),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0]).toMatchObject({ name: "Max" })
  })
})

describe("useDocument", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
  })

  it("returns document data with id", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })

    const { result } = renderHook(() => useDocument("users/u1"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toMatchObject({ id: "u1", name: "Max" })
  })

  it("returns null for non-existent document", async () => {
    const { result } = renderHook(() => useDocument("users/missing"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
  })

  it("returns null for null path", async () => {
    const { result } = renderHook(() => useDocument(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it("reacts to document updates", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })

    const { result } = renderHook(() => useDocument("users/u1"), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.name).toBe("Max")

    act(() => {
      fakeDb.updateDoc(fakeDb.doc("users", "u1"), { name: "Anna" })
    })

    await waitFor(() => expect(result.current.data?.name).toBe("Anna"))
  })
})
