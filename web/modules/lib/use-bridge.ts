// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useMemo } from "react"

// Mirrors checkout-kiosk/src/types.ts. The bridge is only exposed when the
// page is loaded inside the OWW kiosk Electron build. In a regular browser
// tab, `window.bridge` is undefined and the hook returns `available: false`
// with no-op fallbacks — callers feature-detect via `available` / `features`
// rather than checking the window object themselves.

export interface NfcTagEvent {
  physicalUid: string
  url?: string
}

export type BridgeMode = "kiosk"

// Mirrors ResetSessionOptions in checkout-kiosk/src/types.ts. `keepWindowOpen`
// skips the kiosk's autohide-to-tray after the wipe — used by the badge
// takeover so the window stays in front for the user who just tapped (#516).
// Older kiosk builds ignore the extra argument (bug persists until updated).
export interface ResetSessionOptions {
  keepWindowOpen?: boolean
}

interface BridgeApi {
  mode: BridgeMode
  features: readonly string[]
  bearer: () => Promise<string | null>
  resetSession: (opts?: ResetSessionOptions) => Promise<void>
  getUrl: () => Promise<string>
  onUrlChange: (cb: (url: string) => void) => () => void
  onNfcTag: (cb: (payload: NfcTagEvent) => void) => () => void
  // "Neuer Checkout" reset flow (issue #415). The chrome button asks the page
  // to show its confirm; the page acks so the chrome cancels its fallback.
  requestStartOver?: () => void
  ackStartOver?: () => void
  onStartOverRequest?: (cb: () => void) => () => void
  // Fired in the checkout webview when the kiosk's overlay detects the
  // RaiseNow TWINT payment completed (#416). Optional so the web app keeps
  // working against older kiosk builds without this channel.
  onPaymentConfirmed?: (cb: (paymentUuid: string) => void) => () => void
}

interface UseBridgeResult {
  available: boolean
  mode: BridgeMode | null
  features: readonly string[]
  bearer: () => Promise<string | null>
  resetSession: (opts?: ResetSessionOptions) => Promise<void>
  onNfcTag: (cb: (payload: NfcTagEvent) => void) => () => void
  // Tell the chrome the page has the start-over request in hand so it cancels
  // its hardware-escape-hatch fallback. No-op outside the kiosk bridge.
  ackStartOver: () => void
  // Subscribe to the chrome "Neuer Checkout" button. No-op outside the bridge.
  onStartOverRequest: (cb: () => void) => () => void
  onPaymentConfirmed: (cb: (paymentUuid: string) => void) => () => void
}

function getBridge(): BridgeApi | undefined {
  return (window as unknown as { bridge?: BridgeApi }).bridge
}

const NO_OP_UNSUBSCRIBE = () => {}
const EMPTY_FEATURES: readonly string[] = Object.freeze([])

/**
 * Discover the OWW hardware bridge when running inside the Electron host.
 *
 * Returns a stable result object; consumers can feature-detect via
 * `available` or `features.includes("nfc")` and call the methods
 * unconditionally — when the bridge is absent, the methods are
 * graceful no-ops.
 *
 * Non-hook callers that need just the bearer (e.g., fetch interceptors)
 * should read `window.bridge?.bearer?.()` directly; this hook is only for
 * components that also want to subscribe to events.
 */
export function useBridge(): UseBridgeResult {
  return useMemo(() => {
    const bridge = getBridge()
    if (!bridge) {
      return {
        available: false,
        mode: null,
        features: EMPTY_FEATURES,
        bearer: async () => null,
        resetSession: async () => {},
        onNfcTag: () => NO_OP_UNSUBSCRIBE,
        ackStartOver: () => {},
        onStartOverRequest: () => NO_OP_UNSUBSCRIBE,
        onPaymentConfirmed: () => NO_OP_UNSUBSCRIBE,
      }
    }
    return {
      available: true,
      mode: bridge.mode,
      features: bridge.features,
      bearer: bridge.bearer,
      resetSession: bridge.resetSession,
      onNfcTag: bridge.onNfcTag,
      // Older kiosk builds may not expose these — guard so the page degrades
      // gracefully rather than crashing on an undefined call.
      ackStartOver: bridge.ackStartOver ?? (() => {}),
      onStartOverRequest: bridge.onStartOverRequest ?? (() => NO_OP_UNSUBSCRIBE),
      onPaymentConfirmed:
        bridge.onPaymentConfirmed ?? (() => NO_OP_UNSUBSCRIBE),
    }
  }, [])
}

/**
 * Subscribe to NFC tag events from a React component. Auto-unsubscribes on
 * unmount or when `cb` changes. No-op outside the Electron bridge.
 */
export function useNfcTag(cb: (event: NfcTagEvent) => void): void {
  const { available, onNfcTag } = useBridge()
  useEffect(() => {
    if (!available) return
    return onNfcTag(cb)
    // We intentionally key on the callback identity — the caller is
    // expected to memoize if they want a stable subscription across
    // renders.
  }, [available, onNfcTag, cb])
}

/**
 * Non-React accessor for the bearer secret. Returns null in regular
 * browsers (no bridge) and in dev when the kiosk env var is unset; both
 * are acceptable because the Functions emulator middleware bypasses the
 * Bearer check.
 */
export async function resolveBridgeBearer(): Promise<string | null> {
  const bridge = getBridge()
  if (!bridge?.bearer) return null
  const value = await bridge.bearer()
  return typeof value === "string" && value.length > 0 ? value : null
}
