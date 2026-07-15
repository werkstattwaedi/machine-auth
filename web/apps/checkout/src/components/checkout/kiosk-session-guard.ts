// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Cross-tree bridge between the wizard (which knows whether the current
// kiosk session holds anything worth protecting — open checkout, cart
// items, typed-in persons — and whether the visitor is already identified)
// and BridgeNfcRouter (which sits at the root layout, OUTSIDE the wizard,
// and must decide synchronously on a badge tap whether to navigate straight
// away or ask for confirmation first, and which confirmation to show).
//
// A module-level callback registry instead of React context because the
// router must not re-render on every wizard state change — it only needs
// the answer at the instant a tag event arrives. The wizard registers a
// getter (reading from a ref) so the answer is always current.

/**
 * Tap-time snapshot of the kiosk session.
 *
 * - `preservable`: there is in-progress state worth protecting (open
 *   checkout, cart items, typed-in persons) — a tap must confirm first.
 * - `identified`: the current session is already tied to a real person
 *   (signed-in account OR an authenticated badge). When `false` the session
 *   is anonymous: a tap that discards it loses unrecoverable work (there is
 *   no badge to re-tap to bring it back), so the confirmation must be the
 *   honest, destructive variant.
 */
export interface KioskSessionState {
  preservable: boolean
  identified: boolean
  /**
   * Display name of the current (identified) visitor, when known — so the
   * badge-switch confirmation can name whose visit is being parked
   * ("Der Besuch von … ist zwischengespeichert"). `null` for anonymous
   * sessions or when no name is on record.
   */
  holderName: string | null
  /**
   * Token ids of self-service badges already added as line items to the
   * open checkout (server-written `tokenId` on the badge items). A re-tap
   * of one of these must not re-open the purchase offer — the server would
   * reject the duplicate add anyway (issue #515) — so BridgeNfcRouter shows
   * a toast instead. Removing the badge from the cart drops its id here and
   * offering works again.
   */
  badgeTokenIds: string[]
}

const NO_SESSION: KioskSessionState = {
  preservable: false,
  identified: false,
  holderName: null,
  badgeTokenIds: [],
}

let activeGuard: (() => KioskSessionState) | null = null

/**
 * Register the wizard's session-state getter. Returns an unregister function
 * for the provider's unmount cleanup.
 */
export function registerKioskSessionGuard(
  guard: () => KioskSessionState,
): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = null
  }
}

/**
 * The current kiosk session snapshot, or a pristine/anonymous default when
 * no wizard is mounted (nothing to protect, not identified).
 */
export function getKioskSessionState(): KioskSessionState {
  return activeGuard?.() ?? NO_SESSION
}

/**
 * True when a badge tap would discard meaningful in-progress session state
 * and should therefore be confirmed first. False when no wizard is mounted
 * (nothing to protect) or the session is pristine.
 */
export function isKioskSessionPreservable(): boolean {
  return getKioskSessionState().preservable
}
