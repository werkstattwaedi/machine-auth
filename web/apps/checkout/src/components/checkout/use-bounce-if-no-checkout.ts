// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { useWizardContext } from "./wizard-context"

/**
 * QR deep-link guard for `/visit/add/*` sub-routes (issue C2 in the
 * wizard-routes plan). If a visitor scans a material QR cold — no
 * checkin yet, no open checkout doc owned by the current Firebase
 * identity — we cannot create the item for them (no person info, no
 * acceptance of terms). Bounce them to `/checkin` with a hint and let
 * them re-scan after the form is filled.
 *
 * No-op once an open checkout exists, and undecided (no bounce yet) while
 * auth is still restoring or the open-checkout query hasn't delivered its
 * first snapshot — a cold reload would otherwise read "not loaded yet" as
 * "no checkout" and bounce a visitor who has one.
 */
export function useBounceIfNoCheckout() {
  const navigate = useNavigate()
  const { loading: authLoading } = useAuth()
  const { openCheckout, openCheckoutLoading, pendingCheckout, kiosk } =
    useWizardContext()
  const bouncedRef = useRef(false)

  useEffect(() => {
    if (bouncedRef.current) return
    if (openCheckout) return
    if (authLoading || openCheckoutLoading) return
    // A fresh checkout was just written but the onSnapshot listener
    // hasn't surfaced it — give it a beat before bouncing.
    if (pendingCheckout) return
    bouncedRef.current = true
    navigate({
      to: "/checkin",
      search: kiosk
        ? { kiosk: "", rescan: "1" }
        : { rescan: "1" },
    })
  }, [
    authLoading,
    openCheckout,
    openCheckoutLoading,
    pendingCheckout,
    kiosk,
    navigate,
  ])
}
