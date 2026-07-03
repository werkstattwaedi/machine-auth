// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk-session store lifecycle (ADR-0022). The store is module-level so
 * both mint paths (badge tap, email-code sign-in) publish the same session
 * to every useTokenAuth consumer. Covers: establish → visible in the hook;
 * tagSignOut clears; an EXTERNAL Firebase sign-out (e.g. _wizard.tsx's
 * mount-time signOut) clears too, so a stale tokenUser can never outlive
 * its principal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"

const setPersistence = vi.fn().mockResolvedValue(undefined)
const signInWithCustomToken = vi.fn().mockResolvedValue(undefined)
const signOut = vi.fn().mockResolvedValue(undefined)
let authStateCallback: ((user: unknown) => void) | null = null

vi.mock("firebase/auth", () => ({
  inMemoryPersistence: { kind: "in-memory" },
  setPersistence: (...args: unknown[]) => setPersistence(...args),
  signInWithCustomToken: (...args: unknown[]) => signInWithCustomToken(...args),
  signOut: (...args: unknown[]) => signOut(...args),
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authStateCallback = cb
    return () => {
      authStateCallback = null
    }
  },
}))

const fakeAuth = { name: "fake-auth" }
vi.mock("./firebase-context", () => ({
  useFunctions: () => ({}),
  useFirebaseAuth: () => fakeAuth,
}))

import {
  establishKioskSession,
  getKioskTokenUser,
  useTokenAuth,
  type TokenUser,
} from "./token-auth"

const codeUser: TokenUser = {
  tokenId: null,
  userId: "u-code",
  firstName: "Code",
  lastName: "User",
}

describe("kiosk session store", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Reset the module-level store between tests via the external-signout
    // guard (fires only while a hook is mounted, so do it before cleanup).
    if (getKioskTokenUser()) {
      const { unmount } = renderHook(() => useTokenAuth(null, null))
      act(() => authStateCallback?.(null))
      unmount()
    }
    cleanup()
  })

  it("establishKioskSession signs in with in-memory persistence and publishes", async () => {
    const { result } = renderHook(() => useTokenAuth(null, null))
    expect(result.current.tokenUser).toBeNull()
    expect(result.current.isTagAuth).toBe(false)

    await act(() =>
      establishKioskSession(fakeAuth as never, "custom-token", codeUser)
    )

    expect(setPersistence).toHaveBeenCalledWith(
      fakeAuth,
      expect.objectContaining({ kind: "in-memory" })
    )
    expect(signInWithCustomToken).toHaveBeenCalledWith(fakeAuth, "custom-token")
    expect(result.current.tokenUser).toEqual(codeUser)
    expect(result.current.isTagAuth).toBe(true)
  })

  it("tagSignOut clears the store and signs out of Firebase", async () => {
    const { result } = renderHook(() => useTokenAuth(null, null))
    await act(() =>
      establishKioskSession(fakeAuth as never, "custom-token", codeUser)
    )

    await act(() => result.current.tagSignOut())

    expect(signOut).toHaveBeenCalledWith(fakeAuth)
    expect(result.current.tokenUser).toBeNull()
    expect(result.current.isTagAuth).toBe(false)
  })

  it("tagSignOut is a no-op without an established session", async () => {
    const { result } = renderHook(() => useTokenAuth(null, null))
    await act(() => result.current.tagSignOut())
    expect(signOut).not.toHaveBeenCalled()
  })

  it("an external Firebase sign-out clears the published session", async () => {
    const { result } = renderHook(() => useTokenAuth(null, null))
    await act(() =>
      establishKioskSession(fakeAuth as never, "custom-token", codeUser)
    )
    expect(result.current.tokenUser).not.toBeNull()

    // Simulate _wizard.tsx's mount-time signOut: the auth state flips to
    // null without going through tagSignOut.
    act(() => authStateCallback?.(null))

    expect(result.current.tokenUser).toBeNull()
    expect(result.current.isTagAuth).toBe(false)
  })

  it("shares one session across multiple hook instances", async () => {
    const first = renderHook(() => useTokenAuth(null, null))
    const second = renderHook(() => useTokenAuth(null, null))

    await act(() =>
      establishKioskSession(fakeAuth as never, "custom-token", codeUser)
    )

    expect(first.result.current.tokenUser?.userId).toBe("u-code")
    expect(second.result.current.tokenUser?.userId).toBe("u-code")
  })
})
