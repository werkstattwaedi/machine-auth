// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `/checkout/<checkoutId>` — the landing target of the stale-open-checkout
 * reminder email (#531).
 *
 * The email is sent to the account holder, but the link may be opened in a
 * browser with no session, or one signed in as a *different* member. We use
 * the checkout id as a hint to route the recipient to the right place:
 *
 *   - Not signed in → bounce through `/login?redirect=/checkout/<id>` so they
 *     land back here once authenticated.
 *   - Signed in as the owner → forward to `/`, whose dispatcher routes an
 *     open checkout to the right wizard step (a stale one gets the checkout
 *     step + banner).
 *   - Signed in as a different member (the owner's checkout is unreadable to
 *     them under security rules, surfaced as a permission error / no doc) →
 *     show a "wrong account" hint rather than a blank screen, offering a
 *     sign-out to switch accounts.
 *
 * NB: PR #551 (issue #535, `/denied`) introduces a parallel signed-in-user
 * mismatch pattern. This route was built independently off `main` (which does
 * not yet have #551); the two mismatch flows may want consolidating once both
 * land.
 */

import { useEffect, useRef } from "react"
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router"
import { Loader2, AlertTriangle } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { useDocument } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import { checkoutRef } from "@modules/lib/firestore-helpers"
import { Button } from "@modules/components/ui/button"

export const Route = createFileRoute("/checkout/$checkoutId")({
  component: CheckoutByIdRoute,
})

function CheckoutByIdRoute() {
  const { checkoutId } = Route.useParams()
  const db = useDb()
  const navigate = useNavigate()
  const {
    user,
    userDoc,
    loading: authLoading,
    userDocLoading,
    sessionKind,
  } = useAuth()

  // The reminder always targets a real account holder, so only a signed-in
  // owner can read the doc; a wrong-account session gets a permission error.
  const {
    data: checkout,
    loading: checkoutLoading,
    error: checkoutError,
  } = useDocument(user ? checkoutRef(db, checkoutId) : null)

  const signedIn = sessionKind === "real" || sessionKind === "tag"
  const principalLoading =
    authLoading || (sessionKind === "real" && userDocLoading)

  // Latch so a navigate() racing the next tick can't re-fire after we left.
  const dispatchedRef = useRef(false)

  useEffect(() => {
    if (dispatchedRef.current) return
    if (principalLoading) return

    // No session (or anonymous throwaway) → sign in, then come back here.
    if (!user || !signedIn) {
      dispatchedRef.current = true
      navigate({
        to: "/login",
        search: { redirect: `/checkout/${checkoutId}` },
      })
      return
    }

    // Signed in — wait for the checkout read to resolve.
    if (checkoutLoading) return

    // Owner match → hand off to the root dispatcher, which forwards an open
    // checkout to the correct wizard step (stale → checkout step + banner).
    const ownerId =
      sessionKind === "real" ? userDoc?.id : undefined
    const checkoutOwnerId = checkout?.userId?.id
    if (checkout && ownerId && checkoutOwnerId === ownerId) {
      dispatchedRef.current = true
      navigate({ to: "/" })
      return
    }
    // Otherwise (permission error, missing doc, or a different owner) fall
    // through to the "wrong account" hint below.
  }, [
    principalLoading,
    checkoutLoading,
    user,
    signedIn,
    sessionKind,
    userDoc,
    checkout,
    checkoutId,
    navigate,
  ])

  // Wrong-account / unreadable checkout: the signed-in member is not the
  // owner. Use the id as a hint and let them switch accounts.
  const isWrongAccount =
    signedIn &&
    !principalLoading &&
    !checkoutLoading &&
    (checkoutError != null ||
      checkout == null ||
      (sessionKind === "real" &&
        userDoc != null &&
        checkout.userId?.id !== userDoc.id))

  if (isWrongAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-lg border border-amber-300 bg-amber-50 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-600 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-amber-900 mb-2">
            Anderes Konto
          </h1>
          <p className="text-sm text-amber-800 mb-4">
            Dieser offene Besuch gehört zu einem anderen Konto. Bitte melde
            dich mit dem Konto an, das die Erinnerung erhalten hat, um den
            Besuch abzuschliessen.
          </p>
          <Button asChild variant="outline">
            <Link
              to="/login"
              search={{ redirect: `/checkout/${checkoutId}` }}
            >
              Konto wechseln
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}
