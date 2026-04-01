// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup, act } from "@testing-library/react"
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { FirebaseProvider, type FirebaseServices } from "./firebase-context"
import { FakeAuth, createFakeUser } from "../test/fake-auth"
import { FakeFirestore } from "../test/fake-firestore"

let fakeDb: FakeFirestore

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (auth: FakeAuth, cb: (user: unknown) => void) => {
    return auth.onAuthStateChanged(cb as (user: FakeAuth["currentUser"]) => void)
  },
  sendSignInLinkToEmail: vi.fn(),
  isSignInWithEmailLink: () => false,
  signInWithEmailLink: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  linkWithPopup: vi.fn(),
}))

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore")
  return {
    ...actual,
    doc: (...args: unknown[]) => {
      const segments = (args as unknown[]).slice(1) as string[]
      return fakeDb.doc(...segments)
    },
    onSnapshot: (ref: ReturnType<FakeFirestore["doc"]>, cb: (snap: unknown) => void) => {
      return fakeDb.onSnapshotDoc(ref, cb as Parameters<FakeFirestore["onSnapshotDoc"]>[1])
    },
    setDoc: (ref: ReturnType<FakeFirestore["doc"]>, data: Record<string, unknown>) => {
      fakeDb.setDoc(ref, data)
      return Promise.resolve()
    },
    getDoc: (ref: ReturnType<FakeFirestore["doc"]>) => {
      return Promise.resolve(fakeDb.getDoc(ref))
    },
    serverTimestamp: () => ({ _fake: "serverTimestamp" }),
  }
})

// Import after mocks are set up
const { AuthProvider, useAuth } = await import("./auth")

afterEach(() => {
  cleanup()
  window.localStorage.removeItem("pendingGoogleLink")
})

/** Renders a component that displays auth state for assertions. */
function AuthStateDisplay() {
  const { user, userDoc, isAdmin, loading, userDocLoading, pendingGoogleLink } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="userDocLoading">{String(userDocLoading)}</span>
      <span data-testid="user">{user ? user.uid : "null"}</span>
      <span data-testid="isAdmin">{String(isAdmin)}</span>
      <span data-testid="userDoc">{userDoc ? userDoc.id : "null"}</span>
      <span data-testid="pendingGoogleLink">{String(pendingGoogleLink)}</span>
    </div>
  )
}

function renderWithAuth(auth: FakeAuth) {
  const services = {
    db: {} as FirebaseServices["db"],
    auth: auth as unknown as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }

  return render(
    <FirebaseProvider value={services}>
      <AuthProvider>
        <AuthStateDisplay />
      </AuthProvider>
    </FirebaseProvider>,
  )
}

describe("AuthProvider", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
  })

  it("starts with loading=true, then resolves to no user", () => {
    const auth = new FakeAuth()

    renderWithAuth(auth)

    // FakeAuth fires onAuthStateChanged synchronously with null,
    // so after render loading should be false
    expect(screen.getByTestId("loading").textContent).toBe("false")
    expect(screen.getByTestId("user").textContent).toBe("null")
  })

  it("sets user when auth state changes, isAdmin false without user doc", async () => {
    const auth = new FakeAuth()

    renderWithAuth(auth)

    const adminUser = createFakeUser({
      uid: "admin1",
      email: "admin@test.com",
      claims: { admin: true },
    })

    await act(() => {
      auth.setCurrentUser(adminUser)
    })

    expect(screen.getByTestId("loading").textContent).toBe("false")
    expect(screen.getByTestId("user").textContent).toBe("admin1")
    // No user doc exists, so isAdmin must remain false even with admin claims
    expect(screen.getByTestId("isAdmin").textContent).toBe("false")
    expect(screen.getByTestId("userDoc").textContent).toBe("null")
  })

  it("resolves isAdmin only after userDoc loads", async () => {
    const auth = new FakeAuth()

    // Pre-seed the user doc with admin role
    fakeDb.setDoc(fakeDb.doc("users", "admin1"), {
      displayName: null,
      firstName: "Admin",
      lastName: "User",
      email: "admin@test.com",
      roles: ["admin"],
      permissions: [],
      termsAcceptedAt: null,
      userType: "erwachsen",
      billingAddress: null,
    })

    renderWithAuth(auth)

    const adminUser = createFakeUser({
      uid: "admin1",
      email: "admin@test.com",
      claims: { admin: true },
    })

    await act(() => {
      auth.setCurrentUser(adminUser)
    })

    // After Firestore snapshot fires (synchronously in FakeFirestore),
    // userDoc should be loaded and isAdmin should be true
    expect(screen.getByTestId("userDocLoading").textContent).toBe("false")
    expect(screen.getByTestId("isAdmin").textContent).toBe("true")
    expect(screen.getByTestId("userDoc").textContent).toBe("admin1")
  })

  it("does not set isAdmin before userDoc loads (race condition guard)", async () => {
    const auth = new FakeAuth()
    // Intentionally do NOT pre-seed user doc — simulates the window
    // between auth resolving and Firestore snapshot arriving

    renderWithAuth(auth)

    const adminUser = createFakeUser({
      uid: "admin1",
      email: "admin@test.com",
      claims: { admin: true },
    })

    await act(() => {
      auth.setCurrentUser(adminUser)
    })

    // User is authenticated but doc doesn't exist yet
    expect(screen.getByTestId("user").textContent).toBe("admin1")
    // isAdmin must be false — this is the critical assertion:
    // code that redirects non-admins must also check userDocLoading
    expect(screen.getByTestId("isAdmin").textContent).toBe("false")
    expect(screen.getByTestId("userDoc").textContent).toBe("null")

    // Now simulate the Firestore doc arriving
    await act(() => {
      fakeDb.setDoc(fakeDb.doc("users", "admin1"), {
        displayName: null,
        firstName: "Admin",
        lastName: "User",
        email: "admin@test.com",
        roles: ["admin"],
        permissions: [],
        termsAcceptedAt: null,
        userType: "erwachsen",
        billingAddress: null,
      })
    })

    // Now isAdmin should be true
    expect(screen.getByTestId("isAdmin").textContent).toBe("true")
    expect(screen.getByTestId("userDocLoading").textContent).toBe("false")
  })

  it("reads pendingGoogleLink from localStorage", () => {
    const auth = new FakeAuth()

    window.localStorage.setItem("pendingGoogleLink", "true")
    renderWithAuth(auth)

    expect(screen.getByTestId("pendingGoogleLink").textContent).toBe("true")
  })
})
