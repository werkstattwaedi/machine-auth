// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { VariantPrice } from "@oww/shared"

// Single mode today (the admin Electron build was retired in favour of Web NFC
// in the admin web app). Kept as a named type so the bridge still advertises
// its identity and a future mode could be added without a wide refactor.
export type BridgeMode = "kiosk"

// Payload pushed to the renderer/webview when an NTAG 424 DNA tag is tapped.
// `physicalUid` is the raw chip UID exposed by PC/SC — useful for low-level
// diagnostics, but NOT the canonical tag ID. Our tags use PICC randomization
// (SDM), so the canonical ID only falls out of server-side decoding of the
// `picc`/`cmac` parameters carried inside `url`.
export interface NfcTagEvent {
  physicalUid: string
  url?: string
}

export interface Bridge {
  mode: BridgeMode
  features: readonly string[]
  bearer: () => Promise<string | null>
  resetSession: () => Promise<void>
  getUrl: () => Promise<string>
  onUrlChange: (cb: (url: string) => void) => () => void
  // Fired (in the chrome renderer) when the checkout webview requests opening
  // an allowlisted off-origin link (e.g. the Nutzungsbestimmungen page #425 or
  // the RaiseNow TWINT paylink #416) — the renderer mounts an in-kiosk overlay
  // webview at `url`. Returns an unsubscribe fn.
  onOpenOverlay: (cb: (url: string) => void) => () => void
  // Sent by the chrome renderer once it detects the RaiseNow payment_result
  // URL on the overlay webview; main re-broadcasts to the checkout webview.
  notifyPaymentConfirmed: (paymentUuid: string) => void
  // Subscribed by the checkout webview (web app) to auto-mark the bill paid
  // when the TWINT payment completes in the overlay. Returns an unsubscribe fn.
  onPaymentConfirmed: (cb: (paymentUuid: string) => void) => () => void
  onNfcTag: (cb: (payload: NfcTagEvent) => void) => () => void
  // "Neuer Checkout" reset flow (issue #415). The chrome button asks the
  // loaded web page to show its own confirm dialog (single confirm UI) via
  // `requestStartOver`; the page replies with `ackStartOver` once it has the
  // request, which lets the chrome cancel its hardware-escape-hatch fallback.
  requestStartOver: () => void
  ackStartOver: () => void
  onStartOverRequest: (cb: () => void) => () => void
  onStartOverAck: (cb: () => void) => () => void
}

// Compile-time proof that the kiosk can resolve @oww/shared.
export type { VariantPrice }
