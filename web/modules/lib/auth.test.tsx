// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup, act } from "@testing-library/react"
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { FirebaseProvider, type FirebaseServices } from "./firebase-context"
import { FakeAuth, createFakeUser } from "../test/fake-auth"
import { FakeFirestore } from "../test/fake-firestore"

let fakeDb: FakeFirestore

// Shared with the hoisted module mocks below (Google sign-in guard tests).
const { mockSignInWithPopup, mockDeleteUser, mockSignOut, mockRpc } =
  vi.hoisted(() => ({
    mockSignInWithPopup: vi.fn(),
    mockDeleteUser: vi.fn(),
    mockSignOut: vi.fn(),
    mockRpc: vi.fn(),
  }))

vi.mock("./rpc", () => ({
  rpcCallable:
    (_functions: unknown, _group: string, method: string) =>
    (payload: unknown) =>
      mockRpc(method, payload),
}))

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (auth: FakeAuth, cb: (user: unknown) => void) => {
    return auth.onAuthStateChanged(cb as (user: FakeAuth["currentUser"]) => void)
  },
  // The provider listens on the id-token stream (a superset of the
  // auth-state events — ADR-0041); the fake only models sign-in/out.
  onIdTokenChanged: (auth: FakeAuth, cb: (user: unknown) => void) => {
    return auth.onAuthStateChanged(cb as (user: FakeAuth["currentUser"]) => void)
  },
  sendSignInLinkToEmail: vi.fn(),
  isSignInWithEmailLink: () => false,
  signInWithEmailLink: vi.fn(),
  signOut: mockSignOut,
  deleteUser: mockDeleteUser,
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: mockSignInWithPopup,
  getAdditionalUserInfo: () => ({
    profile: { given_name: "Gina", family_name: "Google" },
  }),
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
      <span data-testid="userDocName">{userDoc ? userDoc.name : ""}</span>
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

  // Regression for issue #207: legacy `displayName` field on the Firestore
  // user doc must NOT take priority over `firstName lastName`. Old data may
  // still carry it, but the UI must always show the full real name.
  it("ignores legacy displayName and renders firstName+lastName as name", async () => {
    const auth = new FakeAuth()
    fakeDb.setDoc(fakeDb.doc("users", "user1"), {
      displayName: "MikeS", // legacy nickname value — should be ignored
      firstName: "Michael",
      lastName: "Schneider",
      email: "michael@example.com",
      roles: [],
      permissions: [],
      termsAcceptedAt: null,
      userType: "erwachsen",
      billingAddress: null,
    })

    renderWithAuth(auth)

    const u = createFakeUser({ uid: "user1", email: "michael@example.com" })
    await act(() => {
      auth.setCurrentUser(u)
    })

    expect(screen.getByTestId("userDocName").textContent).toBe(
      "Michael Schneider",
    )
    expect(screen.getByTestId("userDocName").textContent).not.toBe("MikeS")
  })

  it("reads pendingGoogleLink from localStorage", () => {
    const auth = new FakeAuth()

    window.localStorage.setItem("pendingGoogleLink", "true")
    renderWithAuth(auth)

    expect(screen.getByTestId("pendingGoogleLink").textContent).toBe("true")
  })
})

/**
 * Google sign-in guard (ADR-0043, issue #633). Google sign-in is Auth-first:
 * when no Auth record holds the Google e-mail, the popup mints a fresh uid.
 * If a users doc carries that e-mail anyway (its Auth record was deleted or
 * drifted), continuing would sign the member up a second time. The guard
 * drops the doc-less record and sends them to the e-mail code instead.
 */
describe("signInWithGoogle guard (issue #633)", () => {
  let api: ReturnType<typeof useAuth> | null = null
  function Capture() {
    api = useAuth()
    return null
  }

  function renderCapture() {
    const services = {
      db: {} as FirebaseServices["db"],
      auth: new FakeAuth() as unknown as FirebaseServices["auth"],
      functions: {} as FirebaseServices["functions"],
    }
    render(
      <FirebaseProvider value={services}>
        <AuthProvider>
          <Capture />
          <AuthStateDisplay />
        </AuthProvider>
      </FirebaseProvider>,
    )
  }

  const googleUser = createFakeUser({ uid: "google-uid", email: "mia@example.com" })

  async function signIn(): Promise<unknown> {
    let outcome: unknown
    await act(async () => {
      outcome = await api!.signInWithGoogle().catch((err: unknown) => err)
    })
    return outcome
  }

  beforeEach(() => {
    fakeDb = new FakeFirestore()
    api = null
    mockSignInWithPopup.mockReset()
    mockSignInWithPopup.mockResolvedValue({ user: googleUser })
    mockDeleteUser.mockReset()
    mockDeleteUser.mockResolvedValue(undefined)
    mockSignOut.mockReset()
    mockSignOut.mockResolvedValue(undefined)
    mockRpc.mockReset()
  })

  it("drops the doc-less record when the e-mail belongs to a member under another uid", async () => {
    mockRpc.mockResolvedValue({
      data: { exists: true, hasAuthUser: true, hasProfile: true },
    })
    renderCapture()

    const outcome = await signIn()

    expect(outcome).toMatchObject({ code: "oww/existing-account" })
    expect(mockRpc).toHaveBeenCalledWith("checkAccountExists", {
      email: "mia@example.com",
    })
    expect(mockDeleteUser).toHaveBeenCalledWith(googleUser)
    expect(mockSignOut).toHaveBeenCalled()
    // Same follow-up as Firebase's own refusal: offer to link Google after
    // the e-mail sign-in.
    expect(screen.getByTestId("pendingGoogleLink").textContent).toBe("true")
  })

  it("lets a genuinely new Google user through to sign-up", async () => {
    mockRpc.mockResolvedValue({
      data: { exists: false, hasAuthUser: true, hasProfile: false },
    })
    renderCapture()

    const outcome = await signIn()

    expect(outcome).toEqual({
      isNewAccount: true,
      firstName: "Gina",
      lastName: "Google",
    })
    expect(mockDeleteUser).not.toHaveBeenCalled()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it("does not ask (or delete) when the signed-in uid has its own users doc", async () => {
    fakeDb.setDoc(fakeDb.doc("users", "google-uid"), {
      email: "mia@example.com",
      termsAcceptedAt: { _fake: "ts" },
      roles: [],
    })
    renderCapture()

    const outcome = await signIn()

    expect(outcome).toMatchObject({ isNewAccount: false })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it("fails closed when the account check cannot be answered", async () => {
    mockRpc.mockRejectedValue(new Error("unavailable"))
    renderCapture()

    const outcome = await signIn()

    expect(outcome).toMatchObject({ code: "oww/account-check-failed" })
    // The session is dropped, never deleted on a guess …
    expect(mockSignOut).toHaveBeenCalled()
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it("still refuses when the leftover record could not be deleted", async () => {
    // A missed delete (closed tab, network) leaves the record behind; the
    // guard does not key on isNewUser, so the next attempt lands here again
    // and must refuse again rather than fall through to sign-up.
    mockRpc.mockResolvedValue({
      data: { exists: true, hasAuthUser: true, hasProfile: true },
    })
    mockDeleteUser.mockRejectedValue(new Error("network"))
    renderCapture()

    const outcome = await signIn()

    expect(outcome).toMatchObject({ code: "oww/existing-account" })
    expect(mockSignOut).toHaveBeenCalled()
  })
})
