// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type {
  TerminalPaymentEvent,
  TerminalPaymentRequest,
  TerminalPaymentResult,
  VariantPrice,
} from "@oww/shared"

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

// Options for `resetSession`. `keepWindowOpen` skips the autohide-to-tray so
// a badge takeover keeps the kiosk in front for the next user (issue #516);
// omitted/false keeps the default hide ("Neuer Checkout" / post-checkout).
export interface ResetSessionOptions {
  keepWindowOpen?: boolean
}

export interface Bridge {
  mode: BridgeMode
  features: readonly string[]
  // Release version of this kiosk build (ADR-0045), e.g. "2026.10.3".
  version: string
  bearer: () => Promise<string | null>
  resetSession: (opts?: ResetSessionOptions) => Promise<void>
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
  // Subscribed by the checkout webview (web app) to auto-acknowledge the
  // "raisenow" payment method when the TWINT payment completes in the
  // overlay (the bill is not marked paid). Returns an unsubscribe fn.
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
  // Fired (in the chrome renderer) when the window is closed mid-session: main
  // has already wiped the session storage and asks the renderer to reload the
  // checkout webview so the previous user's in-memory session is dropped too.
  // Returns an unsubscribe fn.
  onReloadCheckout: (cb: () => void) => () => void
  // Wallee payment terminal (ADR-0051). Usable when `features` includes
  // "payment-terminal"; otherwise, and for any caller other than the
  // checkout webview, `terminalPay` resolves `unavailable`. Resolves with the
  // final result (never rejects); a second call while one runs resolves
  // `busy`. Display only — the backend settles from Wallee's webhook.
  terminalPay: (req: TerminalPaymentRequest) => Promise<TerminalPaymentResult>
  // Progress of the running payment, delivered to the webContents that
  // started it. Subscribe before calling `terminalPay`. Returns an
  // unsubscribe fn.
  onTerminalEvent: (cb: (event: TerminalPaymentEvent) => void) => () => void
  // Ask the terminal to stop waiting for a card. Resolves true when the abort
  // went out. Once the card is read the terminal ignores it: the
  // `terminalPay` promise still resolves with the real outcome.
  terminalAbort: () => Promise<boolean>
}

// Compile-time proof that the kiosk can resolve @oww/shared.
export type { VariantPrice }
export type { TerminalPaymentEvent, TerminalPaymentRequest, TerminalPaymentResult }
