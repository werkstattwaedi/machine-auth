// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// SDK-agnostic decision helpers for the Electron kiosk's locked-down webview.
//
// The kiosk runs the checkout web app inside an Electron `<webview>` whose
// `webContents` denies every window-open and blocks all off-origin
// navigation (checkout-kiosk/src/main.ts). That lockdown also kills the
// legitimate `target="_blank"` links the app uses for off-origin content
// (e.g. the "Nutzungsbestimmungen" page on werkstattwaedi.ch, or the RaiseNow
// TWINT paylink on pay.raisenow.io). Instead of a generic external-link
// launcher — which would re-open the whole kiosk to arbitrary navigation — we
// mount the allowlisted URL in a dedicated overlay `<webview>` inside the
// kiosk chrome, with a close button, so nothing lingers outside the app.
//
// This module is pure (no Electron import) so it stays unit-testable; the
// Electron wiring in main.ts/renderer.ts is a thin adapter around the
// decisions returned here.

export interface KioskOverlayOptions {
  /**
   * Origins (scheme + host + port, e.g. "https://werkstattwaedi.ch") that
   * are allowed to open inside the kiosk overlay webview. Everything else is
   * denied so the kiosk lockdown is preserved by default.
   */
  allowedOverlayOrigins: readonly string[]
}

export interface KioskOverlayDecision {
  /**
   * `true` only when the requested URL's origin is allowlisted and should be
   * shown in the in-kiosk overlay webview. `false` means the request is
   * denied with no side effects (the kiosk's existing deny-all behaviour).
   */
  open: boolean
}

/**
 * Decide whether a window-open request from the kiosk's checkout webview
 * should be intercepted into the in-kiosk overlay webview.
 *
 * Returns `{ open: true }` only when `url` parses and its origin is present
 * in `allowedOverlayOrigins`; otherwise `{ open: false }`. Malformed URLs are
 * denied. The native window-open is always denied by the caller regardless —
 * this helper only decides whether to additionally surface the URL in the
 * overlay.
 */
export function decideKioskOverlay(
  url: string,
  { allowedOverlayOrigins }: KioskOverlayOptions
): KioskOverlayDecision {
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return { open: false }
  }
  return { open: allowedOverlayOrigins.includes(origin) }
}

// Origin of the RaiseNow TWINT paylink the checkout app links to. Both the
// kiosk overlay allowlist (so the paylink opens in the overlay) and the
// payment-confirmation detection below key off this.
export const RAISENOW_PAYLINK_ORIGIN = "https://pay.raisenow.io"

export interface KioskPaymentConfirmation {
  /**
   * `true` once the RaiseNow paylink, shown in the kiosk overlay, has
   * navigated to its payment-result view — i.e. the customer completed the
   * TWINT payment. RaiseNow signals this by appending
   * `rnw-view=payment_result` together with an `epms_payment_uuid` to the
   * paylink URL.
   */
  paid: boolean
  /**
   * The RaiseNow payment UUID (`epms_payment_uuid`) when `paid` is `true`,
   * otherwise `null`. Carried so callers can log / correlate the payment.
   */
  paymentUuid: string | null
}

const NOT_PAID: KioskPaymentConfirmation = { paid: false, paymentUuid: null }

/**
 * Detect whether a RaiseNow paylink URL (as observed on the kiosk overlay
 * webview after a navigation) indicates a completed TWINT payment.
 *
 * RaiseNow drives the paylink to its result view by appending
 * `rnw-view=payment_result&epms_payment_uuid=<uuid>` to the URL, e.g.:
 *
 *   https://pay.raisenow.io/hxnqv?amount.values=0.50&…&rnw-view=payment_result
 *     &epms_payment_uuid=ef247e5e-6325-4a43-8791-f4a94fbc7e90
 *
 * Returns `{ paid: true, paymentUuid }` only when the URL's origin is the
 * RaiseNow paylink origin AND both markers are present and non-empty;
 * otherwise `{ paid: false, paymentUuid: null }`. Malformed URLs and
 * off-origin URLs are treated as not-paid so an unrelated navigation never
 * marks a checkout paid.
 */
export function detectKioskPaymentConfirmation(
  url: string
): KioskPaymentConfirmation {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NOT_PAID
  }
  if (parsed.origin !== RAISENOW_PAYLINK_ORIGIN) return NOT_PAID
  if (parsed.searchParams.get("rnw-view") !== "payment_result") return NOT_PAID
  const paymentUuid = parsed.searchParams.get("epms_payment_uuid")
  if (!paymentUuid) return NOT_PAID
  return { paid: true, paymentUuid }
}
