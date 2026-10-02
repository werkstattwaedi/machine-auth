// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import type { RouteIntent } from "@/lib/parse-checkout-qr"
import { useWizardContext } from "./wizard-context"

/**
 * QR deep-link guard for the `/visit/add/<list|item|workshop>/…` routes,
 * mounted by the wizard layout (issue #664). A visitor who scans a material
 * QR cold — no open checkout owned by the current principal — cannot add the
 * item yet (no person info, no accepted terms), so they are sent to
 * `/checkin` with the scanned path in `next`; the check-in step returns them
 * to that picker once the visit exists.
 *
 * `intent` is the layout's classification of the current path
 * (`parseCheckoutQr`), `null` for everything that carries no target.
 *
 * Returns true while the current path is such a cold deep link — the layout
 * shows a spinner for it instead of the "Kein offener Besuch" dialog, both
 * while the principal is still resolving and while the redirect is under way.
 */
export function useBounceIfNoCheckout(intent: RouteIntent | null): boolean {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { loading: authLoading, userDocLoading, sessionKind } = useAuth()
  const {
    openCheckout,
    openCheckoutLoading,
    pendingCheckout,
    tagAuthLoading,
    kiosk,
  } = useWizardContext()
  // The path the redirect already fired for. The layout outlives
  // navigations, so a plain once-per-mount latch would swallow a second cold
  // scan in the same page session.
  const bouncedForRef = useRef<string | null>(null)

  // A fresh page load (the phone camera opening the QR link) renders before
  // Firebase Auth has restored the session and before the principal-scoped
  // open-checkout query has answered. Deciding any earlier would send a
  // visitor whose visit is already running back to the check-in.
  const resolving =
    authLoading ||
    tagAuthLoading ||
    (sessionKind === "real" && userDocLoading) ||
    openCheckoutLoading

  // pendingCheckout: a fresh checkout was just written but the onSnapshot
  // listener hasn't surfaced it yet — that is a running visit, not a cold one.
  const cold = intent != null && !openCheckout && !pendingCheckout

  useEffect(() => {
    if (!cold) {
      bouncedForRef.current = null
      return
    }
    if (resolving) return
    if (bouncedForRef.current === pathname) return
    bouncedForRef.current = pathname
    navigate({
      to: "/checkin",
      search: kiosk ? { kiosk: "", next: pathname } : { next: pathname },
      // The cold deep link is not a place to come back to: "back" from the
      // check-in would only bounce again.
      replace: true,
    })
  }, [cold, resolving, pathname, kiosk, navigate])

  return cold
}
