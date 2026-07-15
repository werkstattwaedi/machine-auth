// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * BridgeNfcRouter — kiosk tap routing + session protection:
 *   - pristine session: tap navigates straight to /checkin with the params
 *   - preservable session (open checkout / dirty form): tap probes the tag
 *     (no SDM counter consumed) and opens the right dialog instead of
 *     navigating — switch/discard for a registered badge, the purchase
 *     offer for an unregistered one (identified session), the sign-in-first
 *     notice for an unregistered one (anonymous session)
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react"
import type { NfcTagEvent } from "@modules/lib/use-bridge"

const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}))

const mockToastError = vi.fn()
const mockToastInfo = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
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
  resolveBridgeBearer: vi.fn().mockResolvedValue("kiosk-bearer"),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useFunctions: () => ({}),
}))

// probeTag callable — registered by default; individual tests flip it.
const mockProbeTag = vi.fn()
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: () => mockProbeTag,
}))

// The purchase dialog pulls in the full Firebase/mutation stack (covered by
// its own tests); stub it with a marker that records the offer and mirrors
// the real dialog's voucher-keyed dry-run quote effect, so tests can assert
// that a same-badge re-tap does not re-fire the quote (issue #515).
const { quoteEffectVouchers } = vi.hoisted(() => ({
  quoteEffectVouchers: [] as string[],
}))
vi.mock("./checkout/badge-purchase-dialog", async () => {
  const { useEffect } = await import("react")
  return {
    BadgePurchaseDialog: ({
      offer,
    }: {
      offer: { tokenId: string; badgeVoucher: string } | null
    }) => {
      const voucher = offer?.badgeVoucher ?? null
      useEffect(() => {
        if (voucher) quoteEffectVouchers.push(voucher)
      }, [voucher])
      return offer ? (
        <div data-testid="badge-purchase-stub">
          {offer.tokenId}:{offer.badgeVoucher}
        </div>
      ) : null
    },
  }
})

import { BridgeNfcRouter, confirmTagSwitch } from "./bridge-nfc-router"

const PRISTINE = {
  preservable: false,
  identified: false,
  holderName: null,
  badgeTokenIds: [] as string[],
}
const mockSessionState = vi.fn().mockReturnValue(PRISTINE)
vi.mock("./checkout/kiosk-session-guard", () => ({
  getKioskSessionState: () => mockSessionState(),
}))

beforeEach(() => {
  mockProbeTag.mockResolvedValue({
    data: { tokenId: "t1", registered: true },
  })
})

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockToastError.mockReset()
  mockToastInfo.mockReset()
  mockResetSession.mockClear()
  mockSessionState.mockReset()
  mockSessionState.mockReturnValue(PRISTINE)
  mockProbeTag.mockReset()
  quoteEffectVouchers.length = 0
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

  it("asks for confirmation instead of navigating when a session is active", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(
      await screen.findByText("Laufenden Checkout verwerfen?"),
    ).toBeTruthy()
    expect(mockNavigate).not.toHaveBeenCalled()
    // The pre-check must be the counter-preserving probe, not a full verify.
    expect(mockProbeTag).toHaveBeenCalledWith({
      picc: "PICC1",
      cmac: "CMAC1",
      bearer: "kiosk-bearer",
    })
  })

  it("anonymous session: discard title + red destructive Verwerfen confirm", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(
      await screen.findByText("Laufenden Checkout verwerfen?"),
    ).toBeTruthy()
    // Honest discard copy, not the reassuring handoff.
    expect(screen.getByText(/wird verworfen/)).toBeTruthy()
    expect(screen.queryByText(/zwischengespeichert/)).toBeNull()
    // The confirm carries the destructive fill (matches Neuer Checkout). The
    // base class always references `destructive` for focus/aria rings, so
    // assert on the variant-specific `bg-destructive` fill.
    const confirm = screen.getByRole("button", { name: "Verwerfen" })
    expect(confirm.className).toContain("bg-destructive")
  })

  it("identified session: switch title + default Benutzer wechseln confirm + names the parked visit", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
      badgeTokenIds: [],
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(await screen.findByText("Benutzer wechseln?")).toBeTruthy()
    // Reassuring handoff copy naming the current visitor, no discard warning.
    expect(
      screen.getByText(/Der Besuch von Michael Schneider ist zwischengespeichert/),
    ).toBeTruthy()
    expect(screen.queryByText(/wird verworfen/)).toBeNull()
    const confirm = screen.getByRole("button", { name: "Benutzer wechseln" })
    expect(confirm.className).not.toContain("bg-destructive")
    expect(confirm.className).toContain("bg-primary")
  })

  it("identified session with no holder name: falls back to the name-less handoff copy", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: null,
      badgeTokenIds: [],
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(
      await screen.findByText(/Der offene Besuch ist zwischengespeichert/),
    ).toBeTruthy()
    expect(screen.queryByText(/Der Besuch von/)).toBeNull()
  })

  it("Abbrechen dismisses the dialog and keeps the session", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    await screen.findByText("Laufenden Checkout verwerfen?")
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockResetSession).not.toHaveBeenCalled()
  })

  it("unregistered badge mid-identified-session: purchase offer, session untouched", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
      badgeTokenIds: [],
    })
    mockProbeTag.mockResolvedValue({
      data: {
        tokenId: "04aabbccddeeff",
        registered: false,
        badgeVoucher: "voucher-1",
      },
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(await screen.findByTestId("badge-purchase-stub")).toBeTruthy()
    // No switch dialog, no navigation — the running session is untouched.
    expect(screen.queryByText("Benutzer wechseln?")).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockResetSession).not.toHaveBeenCalled()
  })

  it("same-badge re-tap while the purchase offer is open is a no-op (no quote re-fetch)", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
      badgeTokenIds: [],
    })
    mockProbeTag.mockResolvedValueOnce({
      data: { tokenId: "04aa", registered: false, badgeVoucher: "voucher-1" },
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(await screen.findByTestId("badge-purchase-stub")).toBeTruthy()
    expect(quoteEffectVouchers).toEqual(["voucher-1"])

    // The second physical tap of the SAME badge advances the SDM counter, so
    // the probe mints a FRESH voucher — the guard must still treat it as the
    // same offer.
    mockProbeTag.mockResolvedValueOnce({
      data: { tokenId: "04aa", registered: false, badgeVoucher: "voucher-2" },
    })
    tap(TAG_URL)
    await act(async () => {})
    expect(mockProbeTag).toHaveBeenCalledTimes(2)
    // Offer identity preserved: the dialog still holds the first voucher and
    // its voucher-keyed quote effect fired exactly once (no spinner reset).
    expect(screen.getByTestId("badge-purchase-stub").textContent).toBe(
      "04aa:voucher-1",
    )
    expect(quoteEffectVouchers).toEqual(["voucher-1"])
  })

  it("different unregistered badge while the offer is open replaces it (newest badge wins)", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
      badgeTokenIds: [],
    })
    mockProbeTag.mockResolvedValueOnce({
      data: { tokenId: "04aa", registered: false, badgeVoucher: "voucher-1" },
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(await screen.findByTestId("badge-purchase-stub")).toBeTruthy()

    mockProbeTag.mockResolvedValueOnce({
      data: { tokenId: "04bb", registered: false, badgeVoucher: "voucher-2" },
    })
    tap(TAG_URL)
    await act(async () => {})
    // The offer switched to the new badge and a new quote was fetched for it.
    expect(screen.getByTestId("badge-purchase-stub").textContent).toBe(
      "04bb:voucher-2",
    )
    expect(quoteEffectVouchers).toEqual(["voucher-1", "voucher-2"])
  })

  it("re-tap of a badge already in the checkout: toast instead of the purchase offer", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
      // The badge line item is already in the open checkout — a confirmed
      // purchase parked its tokenId in the session state.
      badgeTokenIds: ["04aa"],
    })
    mockProbeTag.mockResolvedValueOnce({
      data: { tokenId: "04aa", registered: false, badgeVoucher: "voucher-2" },
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    await vi.waitFor(() =>
      expect(mockToastInfo).toHaveBeenCalledWith(
        "Dieser Badge ist bereits im Checkout.",
      ),
    )
    // No dialog of any kind and no navigation — the session stays put.
    expect(screen.queryByTestId("badge-purchase-stub")).toBeNull()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(quoteEffectVouchers).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("unregistered badge mid-anonymous-session: sign-in-first notice, no discard dialog", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    })
    mockProbeTag.mockResolvedValue({
      data: {
        tokenId: "04aabbccddeeff",
        registered: false,
        badgeVoucher: "voucher-1",
      },
    })
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    expect(
      await screen.findByTestId("badge-signin-first-dialog"),
    ).toBeTruthy()
    expect(screen.queryByText("Laufenden Checkout verwerfen?")).toBeNull()
    expect(screen.queryByTestId("badge-purchase-stub")).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("toasts when the mid-session probe fails", async () => {
    mockSessionState.mockReturnValue({
      preservable: true,
      identified: true,
      holderName: null,
      badgeTokenIds: [],
    })
    mockProbeTag.mockRejectedValue(new Error("network"))
    render(<BridgeNfcRouter />)
    tap(TAG_URL)
    await vi.waitFor(() => expect(mockToastError).toHaveBeenCalledOnce())
    expect(mockNavigate).not.toHaveBeenCalled()
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
    // The takeover reset must opt out of the kiosk's autohide-to-tray — the
    // next user is standing at the kiosk (#516). Regressing to a bare
    // resetSession() would hide the window mid-handoff again.
    expect(resetSession).toHaveBeenCalledWith({ keepWindowOpen: true })
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
