// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"

let mockAuth: Record<string, unknown> = {}
vi.mock("@modules/lib/auth", () => ({ useAuth: () => mockAuth }))

let mockBridgeAvailable = false
vi.mock("@modules/lib/use-bridge", () => ({
  useBridge: () => ({ available: mockBridgeAvailable }),
}))

const { MarkerIO } = await import("./marker-io")

function queue(): unknown[][] {
  return (window.Marker as { __cs: unknown[][] }).__cs
}

/** Runs the widget's "load" listeners, as the real shim does once loaded. */
async function fireMarkerLoad() {
  for (const [method, event, listener] of queue()) {
    if (method === "on" && event === "load") (listener as () => void)()
  }
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  mockAuth = { user: null, userDoc: null, sessionKind: null }
  mockBridgeAvailable = false
  vi.stubEnv("VITE_MARKER_LAUNCHER_VISIBLE", "")
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  delete window.Marker
  delete window.__Marker
  delete window.markerConfig
  document.head
    .querySelectorAll('script[src*="edge.marker.io"]')
    .forEach((s) => s.remove())
})

describe("MarkerIO", () => {
  it("loads the widget for a signed-out visitor too", () => {
    render(<MarkerIO app="checkout" />)
    expect(document.head.querySelector('script[src*="edge.marker.io"]')).not.toBeNull()
    expect(window.markerConfig).toMatchObject({
      keyboardShortcuts: true,
      customData: { app: "checkout" },
    })
  })

  it("hides the launcher when the config flag is unset", () => {
    render(<MarkerIO app="checkout" />)
    expect(queue()).toContainEqual(["hide"])
  })

  it("hides the launcher again once the widget loaded", async () => {
    render(<MarkerIO app="checkout" />)
    const hide = vi.fn()
    window.Marker!.hide = hide
    await fireMarkerLoad()
    expect(hide).toHaveBeenCalled()
  })

  it("keeps the launcher when the config flag is \"true\"", async () => {
    vi.stubEnv("VITE_MARKER_LAUNCHER_VISIBLE", "true")
    render(<MarkerIO app="admin" />)
    expect(queue()).not.toContainEqual(["hide"])
    const hide = vi.fn()
    window.Marker!.hide = hide
    await fireMarkerLoad()
    expect(hide).not.toHaveBeenCalled()
  })

  it("pre-fills the reporter for a signed-in member once the widget loaded", async () => {
    mockAuth = {
      user: { uid: "u1", email: "mike@example.com" },
      userDoc: { name: "Mike Schneider" },
      sessionKind: "real",
    }
    render(<MarkerIO app="checkout" />)
    // Before "load" the widget has no project yet and setReporter throws.
    expect(queue().some(([m]) => m === "setReporter")).toBe(false)
    await fireMarkerLoad()
    expect(queue()).toContainEqual([
      "setReporter",
      { email: "mike@example.com", fullName: "Mike Schneider" },
    ])
    expect(queue()).toContainEqual([
      "setCustomData",
      { app: "checkout", sessionKind: "real", kiosk: false },
    ])
  })

  it("swallows a rejected setReporter", async () => {
    mockAuth = {
      user: { uid: "u1", email: "mike@example.com" },
      userDoc: { name: "Mike Schneider" },
      sessionKind: "real",
    }
    render(<MarkerIO app="admin" />)
    const rejection = vi.fn()
    window.addEventListener("unhandledrejection", rejection)
    window.Marker!.setReporter = () => Promise.reject(new Error("no project"))
    await fireMarkerLoad()
    await new Promise((r) => setTimeout(r, 0))
    window.removeEventListener("unhandledrejection", rejection)
    expect(rejection).not.toHaveBeenCalled()
  })

  it("does not set a reporter for kiosk badge sessions, but tags the report", async () => {
    mockAuth = {
      user: { uid: "u1", email: null },
      userDoc: { name: "Badge User", email: "badge@example.com" },
      sessionKind: "tag",
    }
    mockBridgeAvailable = true
    render(<MarkerIO app="checkout" />)
    await fireMarkerLoad()
    expect(queue().some(([m]) => m === "setReporter")).toBe(false)
    expect(queue()).toContainEqual([
      "setCustomData",
      { app: "checkout", sessionKind: "tag", kiosk: true },
    ])
  })

  it("opens the capture on Ctrl+Shift+PrintScreen", () => {
    render(<MarkerIO app="checkout" />)
    fireEvent.keyUp(window, { key: "PrintScreen", ctrlKey: true, shiftKey: true })
    expect(queue()).toContainEqual(["capture", "fullscreen"])
  })

  it("ignores PrintScreen without Ctrl+Shift", () => {
    render(<MarkerIO app="checkout" />)
    fireEvent.keyUp(window, { key: "PrintScreen" })
    fireEvent.keyUp(window, { key: "PrintScreen", shiftKey: true })
    expect(queue().some(([m]) => m === "capture")).toBe(false)
  })
})
