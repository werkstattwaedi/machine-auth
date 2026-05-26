// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useWizardContext } from "./wizard-context"

/**
 * QR deep-link guard for `/visit/add/*` sub-routes (issue C2 in the
 * wizard-routes plan). If a visitor scans a material QR cold — no
 * checkin yet, no open checkout doc owned by the current Firebase
 * identity — we cannot create the item for them (no person info, no
 * acceptance of terms). Bounce them to `/checkin` with a hint and let
 * them re-scan after the form is filled.
 *
 * No-op once an open checkout exists.
 */
export function useBounceIfNoCheckout() {
  const navigate = useNavigate()
  const { openCheckout, kiosk } = useWizardContext()
  const bouncedRef = useRef(false)

  useEffect(() => {
    if (bouncedRef.current) return
    if (openCheckout) return
    bouncedRef.current = true
    navigate({
      to: "/checkin",
      search: kiosk
        ? { kiosk: "", rescan: "1" }
        : { rescan: "1" },
    })
  }, [openCheckout, kiosk, navigate])
}
