// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Cross-tree bridge between the wizard (which knows whether the current
// kiosk session holds anything worth protecting — open checkout, cart
// items, typed-in persons) and BridgeNfcRouter (which sits at the root
// layout, OUTSIDE the wizard, and must decide synchronously on a badge tap
// whether to navigate straight away or ask for confirmation first).
//
// A module-level callback registry instead of React context because the
// router must not re-render on every wizard state change — it only needs
// the answer at the instant a tag event arrives. The wizard registers a
// getter (reading from a ref) so the answer is always current.

let activeGuard: (() => boolean) | null = null

/**
 * Register the wizard's "is there session state worth protecting?" getter.
 * Returns an unregister function for the provider's unmount cleanup.
 */
export function registerKioskSessionGuard(guard: () => boolean): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = null
  }
}

/**
 * True when a badge tap would discard meaningful in-progress session state
 * and should therefore be confirmed first. False when no wizard is mounted
 * (nothing to protect) or the session is pristine.
 */
export function isKioskSessionPreservable(): boolean {
  return activeGuard?.() ?? false
}
