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
   * Issue #769/#752: this session's checkout has been committed (CHK-22) —
   * the confirmation page is showing. The checkout is closed, so nothing is
   * `preservable` any more even though the wizard still holds the visit's
   * persons; a registered badge switches without asking (KIO-6).
   */
  committed: boolean
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
  /**
   * Issue #732: the /checkin "Besuch starten" countdown is running (or its
   * start is in flight). A badge tap then starts this visit first
   * (`startPendingVisit`) and switches without asking.
   */
  autoStartPending: boolean
  /**
   * Issue #732: an identified visitor is on /checkin without a started
   * visit and without a running countdown (they touched the screen, or
   * signed in with a code). A badge tap must ask before switching even when
   * nothing is `preservable` — the visitor may believe their visit started.
   */
  onCheckinScreen: boolean
  /** First name of the identified visitor, for the switch copy. */
  holderFirstName: string | null
}

/** The part of the session snapshot the /checkin screen contributes. */
export type CheckinScreenState = Pick<
  KioskSessionState,
  "autoStartPending" | "onCheckinScreen" | "holderFirstName"
>

type WizardSessionState = Omit<KioskSessionState, keyof CheckinScreenState>

const NO_SESSION: WizardSessionState = {
  preservable: false,
  identified: false,
  committed: false,
  holderName: null,
  badgeTokenIds: [],
}

const NO_CHECKIN_SCREEN: CheckinScreenState = {
  autoStartPending: false,
  onCheckinScreen: false,
  holderFirstName: null,
}

let activeGuard: (() => WizardSessionState) | null = null

interface CheckinScreenRegistration {
  getState: () => CheckinScreenState
  /**
   * Start the pending visit now (create the checkout) without resetting the
   * terminal — the caller switches to the next badge. Resolves with the
   * first name for the "Besuch von … gestartet" toast; rejects when the
   * start failed or did not settle in time (already toasted).
   */
  startPendingVisit: () => Promise<string | null>
}

let activeCheckinScreen: CheckinScreenRegistration | null = null

/**
 * Register the /checkin route's screen state (countdown, unstarted visit).
 * Returns an unregister function for the route's unmount cleanup.
 */
export function registerCheckinScreen(
  registration: CheckinScreenRegistration,
): () => void {
  activeCheckinScreen = registration
  return () => {
    if (activeCheckinScreen === registration) activeCheckinScreen = null
  }
}

/** Start the visit whose countdown is running; see CheckinScreenRegistration. */
export async function startPendingVisit(): Promise<string | null> {
  if (!activeCheckinScreen) throw new Error("No check-in screen mounted")
  return activeCheckinScreen.startPendingVisit()
}

/**
 * Register the wizard's session-state getter. Returns an unregister function
 * for the provider's unmount cleanup.
 */
export function registerKioskSessionGuard(
  guard: () => WizardSessionState,
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
  return {
    ...(activeGuard?.() ?? NO_SESSION),
    ...(activeCheckinScreen?.getState() ?? NO_CHECKIN_SCREEN),
  }
}

/**
 * True when a badge tap would discard meaningful in-progress session state
 * and should therefore be confirmed first. False when no wizard is mounted
 * (nothing to protect) or the session is pristine.
 */
export function isKioskSessionPreservable(): boolean {
  return getKioskSessionState().preservable
}
