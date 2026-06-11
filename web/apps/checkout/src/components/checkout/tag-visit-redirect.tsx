// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { isCheckoutStale } from "@modules/lib/session-day"
import { useWizardContext } from "./wizard-context"

/**
 * Forward a tag-identified user with an open checkout from /checkin to the
 * step that actually concerns them — mirroring what the "/" RootDispatcher
 * does for typed entries:
 *
 *   open checkout from today          →  /visit
 *   open checkout from a previous day →  /checkout (stale banner)
 *
 * Kiosk badge taps land directly on /checkin (issue #420 — routing via "/"
 * would double-verify the tag and trip the SDM replay defense), so without
 * this the returning visitor was stuck on the check-in form even though
 * their visit is already running.
 *
 * The decision is one-shot per identified user, taken when the
 * open-checkout subscription first resolves after identification:
 *   - it never re-fires for a checkout the user creates afterwards on this
 *     terminal ("Besuch starten" must stay on /checkin under its dialog),
 *   - and it doesn't bounce the user back when they deliberately navigate
 *     to /checkin later in the same session.
 */
export function TagVisitRedirect(): null {
  const {
    isTagIdentified,
    identifiedUserRef,
    openCheckout,
    openCheckoutLoading,
    picc,
    cmac,
    kiosk,
  } = useWizardContext()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const decidedForUserRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isTagIdentified || !identifiedUserRef) return
    // Wait for the principal-scoped query's first snapshot — deciding while
    // it loads would misread "still loading" as "no open checkout".
    if (openCheckoutLoading) return
    if (decidedForUserRef.current === identifiedUserRef.id) return
    decidedForUserRef.current = identifiedUserRef.id

    if (!openCheckout) return
    if (!pathname.startsWith("/checkin")) return

    // Preserve the tag/kiosk params like the RootDispatcher does on its
    // redirects, so the wizard layer keeps the same search contract.
    const search: { picc?: string; cmac?: string; kiosk?: string } = {}
    if (picc) search.picc = picc
    if (cmac) search.cmac = cmac
    if (kiosk) search.kiosk = ""

    const created = (
      openCheckout.created as { toDate(): Date } | undefined
    )?.toDate()
    navigate({
      to: created && isCheckoutStale(created) ? "/checkout" : "/visit",
      search,
      replace: true,
    })
  }, [
    isTagIdentified,
    identifiedUserRef,
    openCheckout,
    openCheckoutLoading,
    pathname,
    picc,
    cmac,
    kiosk,
    navigate,
  ])

  return null
}
