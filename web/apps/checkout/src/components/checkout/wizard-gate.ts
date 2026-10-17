// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Which wizard step the layout shows, and whether it must gate the page
 * for want of an open checkout. Pure, so the hand-off at the commit (issue
 * #750) is testable without the router.
 */

export interface WizardGateState {
  pathname: string
  hasOpenCheckout: boolean
  /** A checkout create is in flight (/checkin's "Weiter"). */
  pendingCheckout: boolean
  /** A card was chosen on Check Out (step 4 in place). */
  paymentChosen: boolean
  /** The commit answered: the page shows the confirmation. */
  committed: boolean
  /** The commit (the close) is in flight. */
  submitting: boolean
}

/** The progress indicator's step (0..3), or null outside the steps. */
export function wizardStep(s: WizardGateState): number | null {
  if (s.pathname.startsWith("/checkin")) return 0
  if (s.pathname.startsWith("/visit")) return 1
  if (s.pathname.startsWith("/checkout")) {
    return s.paymentChosen || s.committed ? 3 : 2
  }
  return null
}

/**
 * True when /visit or /checkout has no checkout to act on. Two hand-offs
 * are not that: a fresh checkout whose create is still on its way, and the
 * commit on /checkout — it closes the checkout, which drops out of the
 * open-checkout query possibly before the close answers, and from then on
 * the page shows the confirmation.
 */
export function showNoCheckoutGate(s: WizardGateState): boolean {
  const gateable =
    s.pathname.startsWith("/visit") || s.pathname.startsWith("/checkout")
  const committing =
    s.pathname.startsWith("/checkout") && (s.committed || s.submitting)
  return gateable && !s.hasOpenCheckout && !s.pendingCheckout && !committing
}
