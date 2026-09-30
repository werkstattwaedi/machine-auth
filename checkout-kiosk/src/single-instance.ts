// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Single-instance guard (issue #688). Extracted from main.ts (same pattern as
// reset-session.ts) so the continue-vs-quit decision is unit-testable without
// importing electron.
//
// The kiosk starts hidden in the tray, so a second launch is an easy mistake:
// nothing appears, the operator double-clicks the shortcut again. Every
// running instance then owns a PC/SC handle on the one reader and forwards
// each tap to its own checkout webview; the backend accepts only the request
// carrying the highest SDM read counter, so the instances race and whichever
// window the user is looking at may be the one that lost.

export interface SingleInstanceDeps {
  /** `app.requestSingleInstanceLock()` — true when this process owns it. */
  requestLock: () => boolean
  /** Subscribe to `app.on("second-instance")` — another launch was refused. */
  onSecondInstance: (listener: () => void) => void
  /** `app.quit()`. */
  quit: () => void
  /** Bring the existing kiosk window to the foreground. */
  showWindow: () => void
}

/**
 * Claim the per-installation instance lock. Returns whether startup may
 * continue.
 *
 * `false` means another kiosk already runs: this process has been told to
 * quit and the caller must not start anything. In particular it must not wipe
 * the session partition (shared through `userData` with the running kiosk,
 * which may have a visitor mid-checkout), create a tray icon, or open the NFC
 * reader. The refused launch is not lost — Electron relays it to the running
 * instance as `second-instance`, which surfaces its window, so launching the
 * kiosk "again" does what the operator wanted in the first place.
 */
export function claimSingleInstance(deps: SingleInstanceDeps): boolean {
  if (!deps.requestLock()) {
    deps.quit()
    return false
  }
  deps.onSecondInstance(() => deps.showWindow())
  return true
}
