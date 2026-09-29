// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { chunkIds, useCollection, useDocument, useDocumentsByIds } from "./firestore"
import { FirebaseProvider, type FirebaseServices } from "./firebase-context"
import { FakeFirestore } from "../test/fake-firestore"

// Per-test error injection: map (collection|doc) path -> error to deliver
// to the onSnapshot error callback instead of a snapshot.
const errorPaths = new Map<string, Error>()
// Optional per-path budget of failures: once it hits zero the next subscribe
// falls through to FakeFirestore ("fail N times, then deliver"). Absent =
// fail every time.
const errorBudget = new Map<string, number>()
// Number of onSnapshot registrations per path, to assert re-subscriptions.
const subscribeCounts = new Map<string, number>()

function shouldFail(path: string): boolean {
  if (!errorPaths.has(path)) return false
  const budget = errorBudget.get(path)
  if (budget === undefined) return true
  if (budget <= 0) return false
  errorBudget.set(path, budget - 1)
  return true
}

// Every collection/query listener opened through the mocked onSnapshot, so
// tests can assert how many subscriptions a hook fans out to.
const openedQueries: { path: string; constraints: unknown[] }[] = []

// Spy on the functions-module callable so we can assert useCollection /
// useDocument forward errors to the logClientError Cloud Function.
const mockLogClientErrorCallable = vi.fn().mockResolvedValue({ data: { ok: true } })
const mockHttpsCallable = vi.fn().mockReturnValue(mockLogClientErrorCallable)

vi.mock("firebase/functions", () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}))

// Sentinel for the region-configured Functions instance the app puts in
// context. The hooks must report through THIS instance: a bare
// getFunctions(app) targets us-central1, where nothing is deployed, so the
// report would be dropped silently.
const providedFunctions = {
  region: "europe-west6",
} as unknown as FirebaseServices["functions"]

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
          subscribeCounts.set(docPath, (subscribeCounts.get(docPath) ?? 0) + 1)
          if (shouldFail(docPath)) {
            queueMicrotask(() => onError?.(errorPaths.get(docPath)!))
            return () => {}
          }
          return fakeDb.onSnapshotDoc(
            refOrQuery as ReturnType<FakeFirestore["doc"]>,
            onNext as Parameters<FakeFirestore["onSnapshotDoc"]>[1],
          )
        }
        // Collection or query
        const path = refOrQuery.collectionPath ?? refOrQuery.path ?? ""
        subscribeCounts.set(path, (subscribeCounts.get(path) ?? 0) + 1)
        if (shouldFail(path)) {
          queueMicrotask(() => onError?.(errorPaths.get(path)!))
          return () => {}
        }
        const constraints = (refOrQuery as { constraints?: unknown[] }).constraints ?? []
        openedQueries.push({ path, constraints })
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
    // FakeFirestore resolves Firestore's `__name__` field path to the doc id.
    documentId: () => "__name__",
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
    functions: providedFunctions,
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

    // httpsCallable was wired up for logClientError on the context's
    // region-configured instance and invoked once.
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      providedFunctions,
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

describe("chunkIds", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

  it("returns no chunks for an empty list", () => {
    expect(chunkIds([])).toEqual([])
  })

  it("keeps exactly 30 ids in a single chunk", () => {
    const chunks = chunkIds(ids(30))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(30)
  })

  it("spills the 31st id into a second chunk", () => {
    const chunks = chunkIds(ids(31))
    expect(chunks.map((c) => c.length)).toEqual([30, 1])
    expect(chunks[1]).toEqual(["id-30"])
  })

  it("splits 65 ids into 30 / 30 / 5 preserving order", () => {
    const chunks = chunkIds(ids(65))
    expect(chunks.map((c) => c.length)).toEqual([30, 30, 5])
    expect(chunks.flat()).toEqual(ids(65))
  })
})

describe("useDocumentsByIds", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
    errorPaths.clear()
    openedQueries.length = 0
    sessionStorage.clear()
    mockHttpsCallable.mockClear()
    mockLogClientErrorCallable.mockClear()
  })

  function seedCatalog(count: number): string[] {
    const ids: string[] = []
    for (let i = 1; i <= count; i++) {
      const id = `item-${String(i).padStart(2, "0")}`
      fakeDb.setDoc(fakeDb.doc("catalog", id), { code: `9${String(i).padStart(3, "0")}` })
      ids.push(id)
    }
    return ids
  }

  // Regression for issue #632: a price list with more than 30 items lost
  // every item past the 30th because a single `documentId() in [...]`
  // query is capped at 30 operands.
  it("loads all documents of a 31-id list across two listeners", async () => {
    const ids = seedCatalog(31)

    const { result } = renderHook(
      () => useDocumentsByIds<{ code: string }>(colRef("catalog"), ids),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.data).toHaveLength(31)
    expect(result.current.data.at(-1)).toMatchObject({ id: "item-31", code: "9031" })

    // One `in` query per chunk of 30, each against the doc id.
    const catalogQueries = openedQueries.filter((q) => q.path === "catalog")
    expect(catalogQueries).toHaveLength(2)
    for (const q of catalogQueries) {
      expect(q.constraints).toHaveLength(1)
      expect(q.constraints[0]).toMatchObject({ kind: "where", field: "__name__", op: "in" })
    }
    const operands = catalogQueries.map(
      (q) => (q.constraints[0] as { value: string[] }).value.length,
    )
    expect(operands).toEqual([30, 1])
  })

  it("returns documents in id order and skips ids without a document", async () => {
    seedCatalog(3)

    const { result } = renderHook(
      () =>
        useDocumentsByIds<{ code: string }>(colRef("catalog"), [
          "item-03",
          "missing",
          "item-01",
        ]),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data.map((d) => d.id)).toEqual(["item-03", "item-01"])
  })

  it("resolves immediately with no data for an empty id list", () => {
    const { result } = renderHook(
      () => useDocumentsByIds(colRef("catalog"), []),
      { wrapper: createWrapper() },
    )

    expect(result.current.loading).toBe(false)
    expect(result.current.data).toEqual([])
    expect(openedQueries).toHaveLength(0)
  })

  it("re-subscribes when the id list changes", async () => {
    const ids = seedCatalog(2)

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) =>
        useDocumentsByIds<{ code: string }>(colRef("catalog"), ids),
      { wrapper: createWrapper(), initialProps: { ids: [ids[0]] } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data.map((d) => d.id)).toEqual(["item-01"])

    act(() => {
      rerender({ ids })
    })

    // The stale single-item result must read as loading until the new
    // subscription reports (same guard as useCollection, issue #387).
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data.map((d) => d.id)).toEqual(["item-01", "item-02"])
  })

  it("surfaces a listener error and reports it via logClientError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const err = Object.assign(new Error("Missing or insufficient permissions."), {
      code: "permission-denied",
    })
    errorPaths.set("catalog", err)

    const { result } = renderHook(
      () => useDocumentsByIds(colRef("catalog"), ["item-01"]),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.loading).toBe(false)
    expect(mockHttpsCallable).toHaveBeenCalledWith(providedFunctions, "logClientError")
    expect(mockLogClientErrorCallable).toHaveBeenCalledTimes(1)
    const payload = mockLogClientErrorCallable.mock.calls[0][0] as { path: string; code: string }
    expect(payload.path).toBe("catalog")
    expect(payload.code).toBe("permission-denied")

    consoleSpy.mockRestore()
  })
})

// Issue #654: SDK listener errors are terminal. With `retry`, a
// permission-denied on registration is re-tried a bounded number of times
// with exponential backoff (the rule's inputs may be written by a later
// commit than the one that mounted the caller); without it, behaviour is
// unchanged. Fake timers: LISTENER_DELAY_MS (50 ms) precedes every
// subscribe, so a retry due at T lands its subscribe at T + 50.
describe("listener retry", () => {
  const RETRY = { retry: { attempts: 3, delayMs: 1000 } }
  const LISTENER_DELAY = 50

  function denied() {
    return Object.assign(new Error("Missing or insufficient permissions."), {
      code: "permission-denied",
    })
  }

  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  // Advance to the instant a retry is due (the nonce bump it schedules is
  // committed when `act` exits, which is when the re-subscription effect
  // registers its LISTENER_DELAY timer), then let that delay elapse.
  async function retryAfter(delayMs: number) {
    await tick(delayMs)
    await tick(LISTENER_DELAY)
  }

  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fakeDb = new FakeFirestore()
    errorPaths.clear()
    errorBudget.clear()
    subscribeCounts.clear()
    sessionStorage.clear()
    mockHttpsCallable.mockClear()
    mockLogClientErrorCallable.mockClear()
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleSpy.mockRestore()
  })

  it("useDocument stays loading across denials and resolves once admitted (1 s, 2 s backoff)", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "owner"), { name: "Owner" })
    errorPaths.set("users/owner", denied())
    errorBudget.set("users/owner", 2)

    const { result } = renderHook(
      () => useDocument(docRef("users", "owner"), RETRY),
      { wrapper: createWrapper() },
    )

    // Attempt 1 → denied. Still loading, no error surfaced.
    await tick(LISTENER_DELAY)
    expect(subscribeCounts.get("users/owner")).toBe(1)
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    // First retry is due after 1 s — not a millisecond earlier.
    await tick(999)
    expect(subscribeCounts.get("users/owner")).toBe(1)
    await retryAfter(1)
    expect(subscribeCounts.get("users/owner")).toBe(2)
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    // Second retry after 2 s; the budget is spent, so this one is admitted.
    await tick(1999)
    expect(subscribeCounts.get("users/owner")).toBe(2)
    await retryAfter(1)
    expect(subscribeCounts.get("users/owner")).toBe(3)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toMatchObject({ id: "owner", name: "Owner" })

    // Each denial was still reported.
    expect(mockLogClientErrorCallable).toHaveBeenCalledTimes(2)

    // No further re-subscription once healthy.
    await tick(10_000)
    expect(subscribeCounts.get("users/owner")).toBe(3)
  })

  it("useDocument surfaces the error once all retries are exhausted", async () => {
    errorPaths.set("users/owner", denied())

    const { result } = renderHook(
      () => useDocument(docRef("users", "owner"), RETRY),
      { wrapper: createWrapper() },
    )

    await tick(LISTENER_DELAY) // attempt 1
    await retryAfter(1000) // retry 1
    await retryAfter(2000) // retry 2
    expect(subscribeCounts.get("users/owner")).toBe(3)
    expect(result.current.loading).toBe(true)

    await retryAfter(4000) // retry 3 — last one
    expect(subscribeCounts.get("users/owner")).toBe(4)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).not.toBeNull()
    expect(result.current.data).toBeNull()
    // attempts + 1 reports: the initial failure and every retry.
    expect(mockLogClientErrorCallable).toHaveBeenCalledTimes(4)

    await tick(60_000)
    expect(subscribeCounts.get("users/owner")).toBe(4)
  })

  it("useDocument treats a single error as terminal without the option (unchanged default)", async () => {
    errorPaths.set("users/owner", denied())

    const { result } = renderHook(() => useDocument(docRef("users", "owner")), {
      wrapper: createWrapper(),
    })

    await tick(LISTENER_DELAY)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).not.toBeNull()

    await tick(60_000)
    expect(subscribeCounts.get("users/owner")).toBe(1)
    expect(mockLogClientErrorCallable).toHaveBeenCalledTimes(1)
  })

  it("useDocument does not retry errors other than permission-denied", async () => {
    errorPaths.set(
      "users/owner",
      Object.assign(new Error("boom"), { code: "internal" }),
    )

    const { result } = renderHook(
      () => useDocument(docRef("users", "owner"), RETRY),
      { wrapper: createWrapper() },
    )

    await tick(LISTENER_DELAY)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).not.toBeNull()
    await tick(60_000)
    expect(subscribeCounts.get("users/owner")).toBe(1)
  })

  it("useCollection accepts a trailing retry option and recovers", async () => {
    fakeDb.setDoc(fakeDb.doc("bills", "b1"), { total: 5 })
    errorPaths.set("bills", denied())
    errorBudget.set("bills", 1)

    const { result } = renderHook(
      () => useCollection(colRef("bills"), { retry: { attempts: 1, delayMs: 500 } }),
      { wrapper: createWrapper() },
    )

    await tick(LISTENER_DELAY)
    expect(subscribeCounts.get("bills")).toBe(1)
    expect(result.current.loading).toBe(true)

    await retryAfter(500)
    expect(subscribeCounts.get("bills")).toBe(2)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toHaveLength(1)
  })
})
