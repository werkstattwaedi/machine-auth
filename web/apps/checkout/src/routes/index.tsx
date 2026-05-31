// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { Loader2 } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { useTokenAuth } from "@modules/lib/token-auth"
import { useCollection } from "@modules/lib/firestore"
import {
  checkoutsCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { where } from "firebase/firestore"
import { isCheckoutStale } from "@modules/lib/session-day"

const indexSearchSchema = z.object({
  picc: z.optional(z.string()),
  cmac: z.optional(z.string()),
  kiosk: z.optional(z.string()),
})

/**
 * Root URL is a dispatcher. It checks the current Firebase principal's
 * open checkout state and forwards to the appropriate wizard step:
 *
 *   no open checkout                  →  /checkin
 *   open checkout from today          →  /visit
 *   open checkout from a previous day →  /checkout (red/orange banner)
 *
 * Tag-auth params (picc/cmac/kiosk) and the kiosk flag are preserved on
 * the redirect so the wizard layer picks them up.
 */
export const Route = createFileRoute("/")({
  validateSearch: indexSearchSchema,
  component: RootDispatcher,
})

function RootDispatcher() {
  const db = useDb()
  const navigate = useNavigate()
  const { picc, cmac, kiosk } = Route.useSearch()
  const {
    user,
    userDoc,
    loading: authLoading,
    userDocLoading,
    sessionKind,
  } = useAuth()
  const { tokenUser, loading: tokenLoading } = useTokenAuth(
    picc ?? null,
    cmac ?? null,
  )

  // Classify the principal by sessionKind so a still-loading userDoc on
  // a real login doesn't get misread as anonymous. Without this the
  // dispatcher would briefly query as "anonymous" with anonUid=null,
  // see no checkout, and bounce to /checkin — even though the user has
  // an open checkout under their real userId.
  const identifiedUserRef =
    sessionKind === "real" && userDoc
      ? userRef(db, userDoc.id)
      : sessionKind === "tag" && tokenUser
        ? userRef(db, tokenUser.userId)
        : null
  const anonUid =
    sessionKind === "anonymous" && user?.isAnonymous ? user.uid : null

  const { data: openCheckouts, loading: loadingCheckout } = useCollection(
    identifiedUserRef
      ? checkoutsCollection(db)
      : anonUid
        ? checkoutsCollection(db)
        : null,
    ...(identifiedUserRef
      ? [
          where("userId", "==", identifiedUserRef),
          where("status", "==", "open"),
        ]
      : anonUid
        ? [
            where("userId", "==", null),
            // Key on `firebaseUid` (stable, write-once creator id), not the
            // `modifiedBy` audit field — see wizard-context.tsx for the full
            // rationale. `modifiedBy` is stamped from lagging React auth
            // state and is null when a create races an auth transition, so
            // the dispatcher would miss the freshly-created anon checkout and
            // bounce a returning visitor back to /checkin.
            where("firebaseUid", "==", anonUid),
            where("status", "==", "open"),
          ]
        : []),
  )

  // Wait for everything that materially changes the principal-scoping
  // before deciding. In particular `userDocLoading` matters for real
  // logins — without gating on it the dispatcher reads a still-null
  // userDoc and forwards to /checkin even though the open checkout for
  // that user already exists.
  const principalLoading =
    authLoading ||
    tokenLoading ||
    (sessionKind === "real" && userDocLoading) ||
    (sessionKind === "tag" && !tokenUser && !!(picc && cmac))

  // Latch so a navigate() racing against the next React tick doesn't
  // re-fire after the redirector mounted on the destination route.
  const dispatchedRef = useRef(false)

  useEffect(() => {
    if (dispatchedRef.current) return
    if (principalLoading) return

    const search: { picc?: string; cmac?: string; kiosk?: string } = {}
    if (picc) search.picc = picc
    if (cmac) search.cmac = cmac
    if (kiosk !== undefined) search.kiosk = ""

    // No principal at all → send the visitor to /checkin so the wizard
    // can collect their persons + create an anon principal on advance.
    if (sessionKind === null || !user) {
      dispatchedRef.current = true
      navigate({ to: "/checkin", search })
      return
    }

    // Principal exists — wait for the open-checkout subscription to
    // resolve before deciding.
    if (loadingCheckout) return

    dispatchedRef.current = true
    const openCheckout = openCheckouts[0] ?? null

    if (!openCheckout) {
      navigate({ to: "/checkin", search })
      return
    }

    const created = (openCheckout.created as { toDate(): Date } | undefined)
      ?.toDate()
    if (created && isCheckoutStale(created)) {
      navigate({ to: "/checkout", search })
      return
    }
    navigate({ to: "/visit", search })
  }, [
    principalLoading,
    loadingCheckout,
    openCheckouts,
    sessionKind,
    user,
    picc,
    cmac,
    kiosk,
    navigate,
  ])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}
