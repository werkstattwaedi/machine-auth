// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression for issue #207: legacy `displayName` on a user doc must NOT
 * take priority in the users lookup map. Even when stale data still
 * carries `displayName`, the map value must be the full
 * `firstName lastName`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { type ReactNode } from "react"
import {
  FirebaseProvider,
  type FirebaseServices,
} from "./firebase-context"
import { FakeFirestore } from "../test/fake-firestore"

let fakeDb: FakeFirestore

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => () => Promise.resolve({ data: { ok: true } }),
}))

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
      // collection / query
      const path =
        refOrQuery.collectionPath ?? (refOrQuery.path as string)
      return fakeDb.onSnapshotCollection(
        fakeDb.collection(path),
        (refOrQuery.constraints ?? []) as Parameters<
          FakeFirestore["onSnapshotCollection"]
        >[1],
        onNext as Parameters<FakeFirestore["onSnapshotCollection"]>[2],
      )
    },
  }
})

import { LookupProvider, useLookup } from "./lookup"

function wrap({ children }: { children: ReactNode }) {
  const services = {
    db: fakeDb as unknown as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return (
    <FirebaseProvider value={services}>
      <LookupProvider>{children}</LookupProvider>
    </FirebaseProvider>
  )
}

describe("LookupProvider users map", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
  })

  it("uses firstName+lastName even when legacy displayName is set", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u1"), {
      displayName: "MikeS", // legacy nickname value — must be ignored
      firstName: "Michael",
      lastName: "Schneider",
      email: "michael@example.com",
      roles: [],
      permissions: [],
    })

    const { result } = renderHook(() => useLookup(), { wrapper: wrap })
    await waitFor(() =>
      expect(result.current.users.get("u1")).toBe("Michael Schneider"),
    )
    expect(result.current.users.get("u1")).not.toBe("MikeS")
  })

  it("falls back to user id when both names are empty", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "u2"), {
      firstName: "",
      lastName: "",
      email: null,
      roles: [],
      permissions: [],
    })

    const { result } = renderHook(() => useLookup(), { wrapper: wrap })
    await waitFor(() => expect(result.current.users.get("u2")).toBe("u2"))
  })
})
