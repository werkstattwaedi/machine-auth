// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { KIOSK_LAUNCH_URL } from "@oww/shared"

let bridgeAvailable = false
vi.mock("@modules/lib/use-bridge", () => ({
  useBridge: () => ({ available: bridgeAvailable }),
}))

const auth = {
  currentUser: null as { uid: string } | null,
  authStateReady: () => Promise.resolve(),
}
vi.mock("@modules/lib/firebase-context", () => ({
  useFirebaseAuth: () => auth,
}))

const mockSignOut = vi.fn(async () => {})
vi.mock("firebase/auth", () => ({
  signOut: (...args: unknown[]) => mockSignOut(...(args as [])),
}))

const mockReplace = vi.fn()
const router = { history: { replace: mockReplace } }
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => router,
}))

import { KioskPcGate } from "./kiosk-pc-gate"
import { KIOSK_PC_STORAGE_KEY } from "@/lib/kiosk-pc-marker"

// jsdom cannot navigate to a custom scheme; capture the assignment instead.
let assigned: string[] = []
function stubLocation(search: string, pathname = "/") {
  assigned = []
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname,
      search,
      hash: "",
      get href() {
        return `https://checkout.example${pathname}${search}`
      },
      set href(url: string) {
        assigned.push(url)
      },
    },
  })
}

function renderGate() {
  return render(
    <KioskPcGate>
      <p data-testid="web-checkout" />
    </KioskPcGate>,
  )
}

describe("KioskPcGate", () => {
  const originalLocation = window.location
  beforeEach(() => {
    bridgeAvailable = false
    auth.currentUser = null
    mockSignOut.mockClear()
    mockReplace.mockClear()
    window.localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    })
  })

  it("renders the checkout in an ordinary browser", () => {
    stubLocation("")
    renderGate()
    expect(screen.getByTestId("web-checkout")).toBeTruthy()
    expect(assigned).toEqual([])
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("hands a marked browser over to the kiosk app", () => {
    window.localStorage.setItem(KIOSK_PC_STORAGE_KEY, "1")
    stubLocation("")
    renderGate()
    expect(screen.queryByTestId("web-checkout")).toBeNull()
    expect(assigned).toEqual([KIOSK_LAUNCH_URL])
    fireEvent.click(screen.getByTestId("open-kiosk-app"))
    expect(assigned).toEqual([KIOSK_LAUNCH_URL, KIOSK_LAUNCH_URL])
  })

  it("arms on ?kiosk-pc=1 without launching, and strips the parameter", () => {
    stubLocation("?kiosk-pc=1&from=x", "/checkout")
    renderGate()
    expect(screen.queryByTestId("web-checkout")).toBeNull()
    expect(window.localStorage.getItem(KIOSK_PC_STORAGE_KEY)).toBe("1")
    expect(assigned).toEqual([])
    expect(mockReplace).toHaveBeenCalledExactlyOnceWith("/checkout?from=x")
  })

  it("disarms on ?kiosk-pc=0 and strips the parameter", () => {
    window.localStorage.setItem(KIOSK_PC_STORAGE_KEY, "1")
    stubLocation("?kiosk-pc=0")
    renderGate()
    expect(screen.getByTestId("web-checkout")).toBeTruthy()
    expect(window.localStorage.getItem(KIOSK_PC_STORAGE_KEY)).toBeNull()
    expect(mockReplace).toHaveBeenCalledExactlyOnceWith("/")
  })

  it("signs out a login left behind in a marked browser", async () => {
    window.localStorage.setItem(KIOSK_PC_STORAGE_KEY, "1")
    auth.currentUser = { uid: "member-1" }
    stubLocation("")
    renderGate()
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledExactlyOnceWith(auth))
  })

  it("leaves logins alone in an ordinary browser", async () => {
    auth.currentUser = { uid: "member-1" }
    stubLocation("")
    renderGate()
    await Promise.resolve()
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it("is inert inside the kiosk app", () => {
    window.localStorage.setItem(KIOSK_PC_STORAGE_KEY, "1")
    auth.currentUser = { uid: "tag:abc" }
    stubLocation("?kiosk-pc=1")
    bridgeAvailable = true
    renderGate()
    expect(screen.getByTestId("web-checkout")).toBeTruthy()
    expect(assigned).toEqual([])
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it("does not let ?kiosk past the gate outside the kiosk app", () => {
    window.localStorage.setItem(KIOSK_PC_STORAGE_KEY, "1")
    stubLocation("?kiosk")
    renderGate()
    expect(screen.queryByTestId("web-checkout")).toBeNull()
  })
})
