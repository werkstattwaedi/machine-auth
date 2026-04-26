// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import { useFirestoreMutation } from "./use-firestore-mutation"
import { FirebaseProvider, type FirebaseServices } from "../lib/firebase-context"
import { FakeFirestore } from "../test/fake-firestore"

// Mock auth to avoid Firebase init
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "test-user" },
    userDoc: null,
    isAdmin: false,
    loading: false,
    userDocLoading: false,
  }),
}))

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

let fakeDb: FakeFirestore

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore")
  return {
    ...actual,
    setDoc: (ref: ReturnType<FakeFirestore["doc"]>, data: Record<string, unknown>) => {
      fakeDb.setDoc(ref, data)
      return Promise.resolve()
    },
    addDoc: (colRef: ReturnType<FakeFirestore["collection"]>, data: Record<string, unknown>) => {
      const ref = fakeDb.addDoc(colRef, data)
      return Promise.resolve(ref)
    },
    updateDoc: (ref: ReturnType<FakeFirestore["doc"]>, data: Record<string, unknown>) => {
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

function createWrapper() {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return ({ children }: { children: ReactNode }) => (
    <FirebaseProvider value={services}>{children}</FirebaseProvider>
  )
}

// Hand FakeFirestore refs through; the mutation hook only forwards them
// to the (mocked) SDK functions, so the cast is safe at runtime.
function colRef<T = Record<string, unknown>>(path: string) {
  return fakeDb.collection(path) as unknown as import("firebase/firestore").CollectionReference<T>
}

function docRef<T = Record<string, unknown>>(...segments: string[]) {
  return fakeDb.doc(...segments) as unknown as import("firebase/firestore").DocumentReference<T>
}

describe("useFirestoreMutation", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
  })

  it("set writes a document", async () => {
    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.set(docRef("users", "u1"), { name: "Max" })
    })

    const data = fakeDb.getData("users", "u1")
    expect(data?.name).toBe("Max")
  })

  it("set adds audit fields", async () => {
    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.set(docRef("users", "u1"), { name: "Max" })
    })

    const data = fakeDb.getData("users", "u1")
    expect(data?.modifiedBy).toBe("test-user")
    expect(data?.modifiedAt).toBeInstanceOf(Date)
  })

  it("add creates a document with auto ID", async () => {
    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.add(colRef("users"), { name: "Anna" })
    })

    const allDocs = fakeDb.getAllDocs("users")
    expect(allDocs.size).toBe(1)
    const [, data] = [...allDocs.entries()][0]
    expect(data.name).toBe("Anna")
    expect(data.modifiedBy).toBe("test-user")
  })

  it("update merges data into existing doc", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max", age: 30 })

    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.update(docRef("users", "u1"), { age: 31 })
    })

    const data = fakeDb.getData("users", "u1")
    expect(data?.name).toBe("Max")
    expect(data?.age).toBe(31)
    expect(data?.modifiedBy).toBe("test-user")
  })

  it("remove deletes a document", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), { name: "Max" })

    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.remove(docRef("users", "u1"))
    })

    expect(fakeDb.getData("users", "u1")).toBeUndefined()
  })

  it("tracks loading state", async () => {
    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    expect(result.current.loading).toBe(false)

    let resolvePromise: () => void
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })

    act(() => {
      result.current.mutate(() => promise)
    })

    await waitFor(() => expect(result.current.loading).toBe(true))

    await act(async () => {
      resolvePromise!()
      await promise
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it("sets error state on failure", async () => {
    const { result } = renderHook(() => useFirestoreMutation(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      try {
        await result.current.mutate(() => Promise.reject(new Error("fail")))
      } catch {
        // expected
      }
    })

    expect(result.current.error?.message).toBe("fail")
  })
})
