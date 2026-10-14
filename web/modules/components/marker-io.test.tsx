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

  it("keeps the launcher when the config flag is \"true\"", () => {
    vi.stubEnv("VITE_MARKER_LAUNCHER_VISIBLE", "true")
    render(<MarkerIO app="admin" />)
    expect(queue()).not.toContainEqual(["hide"])
  })

  it("pre-fills the reporter for a signed-in member", () => {
    mockAuth = {
      user: { uid: "u1", email: "mike@example.com" },
      userDoc: { name: "Mike Schneider" },
      sessionKind: "real",
    }
    render(<MarkerIO app="checkout" />)
    expect(queue()).toContainEqual([
      "setReporter",
      { email: "mike@example.com", fullName: "Mike Schneider" },
    ])
    expect(queue()).toContainEqual([
      "setCustomData",
      { app: "checkout", sessionKind: "real", kiosk: false },
    ])
  })

  it("does not set a reporter for kiosk badge sessions, but tags the report", () => {
    mockAuth = {
      user: { uid: "u1", email: null },
      userDoc: { name: "Badge User", email: "badge@example.com" },
      sessionKind: "tag",
    }
    mockBridgeAvailable = true
    render(<MarkerIO app="checkout" />)
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
