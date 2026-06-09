// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// SDK-agnostic decision helper for the Electron kiosk's locked-down webview.
//
// The kiosk runs the checkout web app inside an Electron `<webview>` whose
// `webContents` denies every window-open and blocks all off-origin
// navigation (checkout-kiosk/src/main.ts). That lockdown also kills the
// legitimate `target="_blank"` links the app uses for off-origin content
// (e.g. the "Nutzungsbestimmungen" page on werkstattwaedi.ch). Instead of a
// generic external-link launcher — which would re-open the whole kiosk to
// arbitrary navigation — we mount the allowlisted URL in a dedicated overlay
// `<webview>` inside the kiosk chrome, with a close button, so nothing
// lingers outside the app.
//
// This module is pure (no Electron import) so it stays unit-testable; the
// Electron wiring in main.ts/renderer.ts is a thin adapter around the
// decision returned here.

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
