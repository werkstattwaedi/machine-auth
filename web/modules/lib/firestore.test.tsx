// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { useCollection, useDocument } from "./firestore"
import { FirebaseProvider, type FirebaseServices } from "./firebase-context"
import { FakeFirestore } from "../test/fake-firestore"

// Per-test error injection: map (collection|doc) path -> error to deliver
// to the onSnapshot error callback instead of a snapshot.
const errorPaths = new Map<string, Error>()

// Spy on the functions-module callable so we can assert useCollection /
// useDocument forward errors to the logClientError Cloud Function.
const mockLogClientErrorCallable = vi.fn().mockResolvedValue({ data: { ok: true } })
const mockHttpsCallable = vi.fn().mockReturnValue(mockLogClientErrorCallable)

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}))

/**
 * The real useCollection/useDocument hooks call `onSnapshot` and (for
 * collections with constraints) `query`. After issue #145 the hooks accept
 * typed refs directly, so we no longer mock collection()/doc() here — the
 * tests pass FakeFirestore refs in directly.
 *
 * We still need to bridge `onSnapshot` and `query` to FakeFirestore.
 */

let fakeDb: FakeFirestore

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore")
  return {
    ...actual,
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
      refOrQuery: { type: string; path?: string; collectionPath?: string; constraints?: unknown[] },
      onNext: (snap: unknown) => void,
      onError?: (err: Error) => void,
    ) => {
      try {
        if (refOrQuery.type === "document") {
          const docPath = (refOrQuery as { path?: string }).path ?? ""
          const injected = errorPaths.get(docPath)
          if (injected) {
            queueMicrotask(() => onError?.(injected))
            return () => {}
          }
          return fakeDb.onSnapshotDoc(
            refOrQuery as ReturnType<FakeFirestore["doc"]>,
            onNext as Parameters<FakeFirestore["onSnapshotDoc"]>[1],
          )
        }
        // Collection or query
        const path = refOrQuery.collectionPath ?? refOrQuery.path ?? ""
        const injected = errorPaths.get(path)
        if (injected) {
          queueMicrotask(() => onError?.(injected))
          return () => {}
        }
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
    db: { app: {} } as unknown as FirebaseServices["db"], // placeholder — hooks use mocked SDK
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return ({ children }: { children: ReactNode }) => (
    <FirebaseProvider value={services}>{children}</FirebaseProvider>
  )
}

// Convenience: hand the FakeFirestore ref through a cast because the hooks
// expect the real SDK's CollectionReference<T> / DocumentReference<T> types.
function colRef<T = unknown>(path: string) {
  return fakeDb.collection(path) as unknown as import("firebase/firestore").CollectionReference<T>
}

function docRef<T = unknown>(...segments: string[]) {
  return fakeDb.doc(...segments) as unknown as import("firebase/firestore").DocumentReference<T>
}

describe("useCollection", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
    errorPaths.clear()
    sessionStorage.clear()
    mockHttpsCallable.mockClear()
    mockLogClientErrorCallable.mockClear()
  })

  it("returns empty array initially for empty collection", async () => {
    const { result } = renderHook(() => useCollection(colRef("users")), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it("returns documents with id field", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })
    fakeDb.setDoc(fakeDb.doc("users", "u2"), { name: "Anna" })

    const { result } = renderHook(() => useCollection(colRef("users")), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0]).toMatchObject({ id: "u1", name: "Max" })
    expect(result.current.data[1]).toMatchObject({ id: "u2", name: "Anna" })
  })

  it("returns empty for null ref", async () => {
    const { result } = renderHook(() => useCollection(null), {
      wrapper: createWrapper(),
    })

    // Should resolve immediately (no delay) for null ref
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual([])
  })

  it("reacts to data changes", async () => {
    const { result } = renderHook(() => useCollection(colRef("users")), {
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
      () => useCollection(colRef("users"), where("role", "==", "admin")),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0]).toMatchObject({ name: "Max" })
  })

  // Regression for issue #387: when a caller swaps a `null` ref for a real
  // query (e.g. once a user id resolves), the requested path changes
  // immediately but the re-subscription effect runs on the next tick. The
  // hook must report `loading: true` in that one-render window instead of
  // exposing the stale `loading:false` / empty `data` from the null ref —
  // otherwise the root dispatcher misreads "no open checkout" and bounces
  // to /checkin.
  it("reports loading while a freshly-swapped ref re-subscribes", async () => {
    fakeDb.setDoc(fakeDb.doc("checkouts", "c1"), { status: "open" })

    // Record every render's result. The race we guard against is a
    // *consumer* (the root dispatcher) reading the hook's return value on
    // the render where the ref just became non-null — before any effect
    // (including the hook's own setLoading(true)) has run. A post-effect
    // assertion via `result.current` would miss it because effects flush
    // inside act(). So we inspect the render-by-render snapshots instead.
    const renders: { loading: boolean; data: unknown[] }[] = []

    const { rerender } = renderHook(
      ({ ref }: { ref: ReturnType<typeof colRef> | null }) => {
        const r = useCollection(ref)
        renders.push({ loading: r.loading, data: r.data })
        return r
      },
      {
        wrapper: createWrapper(),
        initialProps: { ref: null as ReturnType<typeof colRef> | null },
      },
    )

    // Last render with the null ref: not loading, empty data.
    expect(renders.at(-1)).toEqual({ loading: false, data: [] })

    const before = renders.length

    // Swap in a real ref.
    act(() => {
      rerender({ ref: colRef("checkouts") })
    })

    // The render produced *immediately* by the ref swap — index `before`,
    // before the subscription effect committed setLoading(true) — must not
    // expose loading:false with empty data. That stale "loaded, nothing
    // here" reading is exactly what bounced users to /checkin (issue #387).
    const swapRender = renders[before]
    expect(swapRender).toBeDefined()
    expect(
      swapRender.loading === false && swapRender.data.length === 0,
    ).toBe(false)

    // Once the snapshot resolves, loading clears and data is present.
    await waitFor(() => expect(renders.at(-1)?.loading).toBe(false))
    expect(renders.at(-1)?.data).toHaveLength(1)
  })

  it("logs and reports snapshot errors via console.error + logClientError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const err = Object.assign(new Error("Missing or insufficient permissions."), {
      code: "permission-denied",
    })
    errorPaths.set("bills", err)

    const { result } = renderHook(() => useCollection(colRef("bills")), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.loading).toBe(false)

    // console.error was called with the expected shape.
    expect(consoleSpy).toHaveBeenCalled()
    const firstCallArgs = consoleSpy.mock.calls[0]
    expect(firstCallArgs[0]).toBe("[firestore] error")
    const details = firstCallArgs[1] as {
      path: string
      code: string
      sessionId: string
      message: string
    }
    expect(details.path).toBe("bills")
    expect(details.code).toBe("permission-denied")
    expect(details.sessionId).toMatch(/^[0-9a-z]{8}$/)
    expect(details.message).toBe("Missing or insufficient permissions.")

    // httpsCallable was wired up for logClientError and invoked once.
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      "logClientError",
    )
    expect(mockLogClientErrorCallable).toHaveBeenCalledTimes(1)
    const payload = mockLogClientErrorCallable.mock.calls[0][0] as {
      sessionId: string
      context: string
      code: string
      path: string
    }
    expect(payload.context).toBe("firestore")
    expect(payload.code).toBe("permission-denied")
    expect(payload.path).toBe("bills")
    expect(payload.sessionId).toBe(details.sessionId)

    consoleSpy.mockRestore()
  })
})

describe("useDocument", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
    errorPaths.clear()
    sessionStorage.clear()
    mockHttpsCallable.mockClear()
    mockLogClientErrorCallable.mockClear()
  })

  it("returns document data with id", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })

    const { result } = renderHook(() => useDocument(docRef("users", "u1")), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toMatchObject({ id: "u1", name: "Max" })
  })

  it("returns null for non-existent document", async () => {
    const { result } = renderHook(
      () => useDocument(docRef("users", "missing")),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeNull()
  })

  it("returns null for null ref", async () => {
    const { result } = renderHook(() => useDocument(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it("reacts to document updates", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })

    const { result } = renderHook(
      () => useDocument(docRef<{ name: string }>("users", "u1")),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.name).toBe("Max")

    act(() => {
      fakeDb.updateDoc(fakeDb.doc("users", "u1"), { name: "Anna" })
    })

    await waitFor(() => expect(result.current.data?.name).toBe("Anna"))
  })
})
