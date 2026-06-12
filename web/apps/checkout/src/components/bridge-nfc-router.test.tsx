// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * BridgeNfcRouter — kiosk tap routing + session protection:
 *   - pristine session: tap navigates straight to /checkin with the params
 *   - preservable session (open checkout / dirty form): tap opens a
 *     confirmation instead of navigating
 *   - Abbrechen keeps the current session, no navigation
 *   - confirmTagSwitch wipes the bridge partition and hard-reloads into
 *     /checkin carrying the NEW tag's params
 *   - unreadable taps (no url / missing params) toast
 *   - anonymous (un-identified) preservable session: title frames the
 *     discard, the confirm is the red destructive "Verwerfen" variant (#468)
 *   - identified preservable session: title frames the badge switch, the
 *     confirm keeps the benign default "Benutzer wechseln" variant, and the body
 *     names whose visit is parked when the holder name is known (#468)
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

const PRISTINE = { preservable: false, identified: false, holderName: null }
const mockSessionState = vi.fn().mockReturnValue(PRISTINE)
vi.mock("./checkout/kiosk-session-guard", () => ({
  getKioskSessionState: () => mockSessionState(),
}))

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockToastError.mockReset()
  mockResetSession.mockClear()
  mockSessionState.mockReset()
  mockSessionState.mockReturnValue(PRISTINE)
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
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("asks for confirmation instead of navigating when a session is active", () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: false,
      holderName: null,
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByText("Laufenden Checkout verwerfen?")).toBeTruthy()
  })

  it("anonymous session: discard title + red destructive Verwerfen confirm", () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: false,
      holderName: null,
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(screen.getByText("Laufenden Checkout verwerfen?")).toBeTruthy()
    // Honest discard copy, not the reassuring handoff.
    expect(screen.getByText(/wird verworfen/)).toBeTruthy()
    expect(screen.queryByText(/zwischengespeichert/)).toBeNull()
    // The confirm carries the destructive fill (matches Neuer Checkout). The
    // base class always references `destructive` for focus/aria rings, so
    // assert on the variant-specific `bg-destructive` fill.
    const confirm = screen.getByRole("button", { name: "Verwerfen" })
    expect(confirm.className).toContain("bg-destructive")
  })

  it("identified session: switch title + default Benutzer wechseln confirm + names the parked visit", () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(screen.getByText("Benutzer wechseln?")).toBeTruthy()
    // Reassuring handoff copy naming the current visitor, no discard warning.
    expect(
      screen.getByText(/Der Besuch von Michael Schneider ist zwischengespeichert/),
    ).toBeTruthy()
    expect(screen.queryByText(/wird verworfen/)).toBeNull()
    const confirm = screen.getByRole("button", { name: "Benutzer wechseln" })
    expect(confirm.className).not.toContain("bg-destructive")
    expect(confirm.className).toContain("bg-primary")
  })

  it("identified session with no holder name: falls back to the name-less handoff copy", () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: null,
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(
      screen.getByText(/Der offene Besuch ist zwischengespeichert/),
    ).toBeTruthy()
    expect(screen.queryByText(/Der Besuch von/)).toBeNull()
  })

  it("Abbrechen dismisses the dialog and keeps the session", () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: false,
      holderName: null,
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
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
