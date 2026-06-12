// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * BridgeNfcRouter — kiosk tap routing + session protection:
 *   - pristine session: tap navigates straight to /checkin with the params
 *   - preservable session (open checkout / dirty form): tap opens the
 *     "Neuer Badge erkannt" confirmation instead of navigating
 *   - Abbrechen keeps the current session, no navigation
 *   - confirmTagSwitch wipes the bridge partition and hard-reloads into
 *     /checkin carrying the NEW tag's params
 *   - unreadable taps (no url / missing params) toast
 *   - anonymous (un-identified) preservable session: the confirm is the red
 *     destructive variant with honest "gehen verloren" loss copy (#468)
 *   - identified preservable session: the confirm keeps the benign default
 *     variant and the reassuring "erscheint wieder" handoff copy (#468)
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react"
import type { NfcTagEvent } from "@modules/lib/use-bridge"
import { BridgeNfcRouter, confirmTagSwitch } from "./bridge-nfc-router"

const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}))

const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}))

let tagCallback: ((event: NfcTagEvent) => void) | null = null
const mockResetSession = vi.fn().mockResolvedValue(undefined)
vi.mock("@modules/lib/use-bridge", () => ({
  useBridge: () => ({
    available: true,
    features: ["nfc"],
    onNfcTag: (cb: (event: NfcTagEvent) => void) => {
      tagCallback = cb
      return () => {
        tagCallback = null
      }
    },
    resetSession: mockResetSession,
  }),
}))

const mockSessionState = vi
  .fn()
  .mockReturnValue({ preservable: false, identified: false })
vi.mock("./checkout/kiosk-session-guard", () => ({
  getKioskSessionState: () => mockSessionState(),
}))

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockToastError.mockReset()
  mockResetSession.mockClear()
  mockSessionState.mockReset()
  mockSessionState.mockReturnValue({ preservable: false, identified: false })
  tagCallback = null
})

const TAG_URL = "https://id.example.ch/?picc=PICC1&cmac=CMAC1"

function tap(url?: string) {
  act(() => {
    tagCallback?.({ physicalUid: "uid1", ...(url ? { url } : {}) })
  })
}

describe("BridgeNfcRouter", () => {
  it("navigates straight to /checkin when the session is pristine", () => {
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/checkin",
      search: { picc: "PICC1", cmac: "CMAC1", kiosk: "" },
      replace: true,
    })
    expect(screen.queryByText("Neuer Badge erkannt")).toBeNull()
  })

  it("asks for confirmation instead of navigating when a session is active", () => {
    mockSessionState.mockReturnValue({ preservable: true, identified: false })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByText("Neuer Badge erkannt")).toBeTruthy()
  })

  it("anonymous session: confirm is destructive (red) with honest loss copy", () => {
    mockSessionState.mockReturnValue({ preservable: true, identified: false })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    // Honest copy: the in-progress work is lost, NOT the reassuring handoff.
    expect(screen.getByText(/gehen dabei verloren/)).toBeTruthy()
    expect(screen.queryByText(/erscheint wieder/)).toBeNull()
    // The confirm carries the destructive button styling (matches Neuer
    // Checkout), not the benign default. The base class always references
    // `destructive` (focus/aria rings), so assert on the variant-specific
    // `bg-destructive` fill instead.
    const confirm = screen.getByRole("button", {
      name: "Mit neuem Badge fortfahren",
    })
    expect(confirm.className).toContain("bg-destructive")
  })

  it("identified session: confirm keeps the default variant + handoff copy", () => {
    mockSessionState.mockReturnValue({ preservable: true, identified: true })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    // Reassuring handoff copy, no loss warning.
    expect(screen.getByText(/erscheint wieder/)).toBeTruthy()
    expect(screen.queryByText(/gehen dabei verloren/)).toBeNull()
    const confirm = screen.getByRole("button", {
      name: "Mit neuem Badge fortfahren",
    })
    expect(confirm.className).not.toContain("bg-destructive")
    expect(confirm.className).toContain("bg-primary")
  })

  it("Abbrechen dismisses the dialog and keeps the session", () => {
    mockSessionState.mockReturnValue({ preservable: true, identified: false })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(screen.queryByText("Neuer Badge erkannt")).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockResetSession).not.toHaveBeenCalled()
  })

  it("toasts when the tap carries no url", () => {
    render(<BridgeNfcRouter />)
    tap(undefined)
    expect(mockToastError).toHaveBeenCalledOnce()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("toasts when the url lacks the SDM params", () => {
    render(<BridgeNfcRouter />)
    tap("https://id.example.ch/?foo=bar")
    expect(mockToastError).toHaveBeenCalledOnce()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe("confirmTagSwitch", () => {
  it("wipes the bridge session then reloads into /checkin with the new params", async () => {
    const resetSession = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()
    await confirmTagSwitch({
      tag: { picc: "P2", cmac: "C2" },
      resetSession,
      reload,
    })
    expect(resetSession).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledWith("/checkin?kiosk=&picc=P2&cmac=C2")
  })

  it("still reloads when the bridge wipe fails", async () => {
    const resetSession = vi.fn().mockRejectedValue(new Error("ipc down"))
    const reload = vi.fn()
    await confirmTagSwitch({
      tag: { picc: "P2", cmac: "C2" },
      resetSession,
      reload,
    })
    expect(reload).toHaveBeenCalledOnce()
  })
})
