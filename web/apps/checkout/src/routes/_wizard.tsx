// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { signOut } from "firebase/auth"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useFirebaseAuth } from "@modules/lib/firebase-context"
import { usePricingConfig } from "@modules/lib/workshop-config"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { Avatar } from "@modules/components/ui/avatar"
import { AlertTriangle, Loader2 } from "lucide-react"
import { WizardProvider, useWizardContext } from "@/components/checkout/wizard-context"
import { CheckoutProgress } from "@/components/checkout/checkout-progress"
import { StaleCheckoutBanner } from "@/components/checkout/stale-checkout-banner"
import { StartOverButton } from "@/components/checkout/start-over-button"
import { KioskInactivityWatcher } from "@/components/checkout/kiosk-inactivity-watcher"
import { NoCheckoutGate } from "@/components/checkout/no-checkout-gate"
import { TagAuthOverlay } from "@/components/checkout/tag-auth-overlay"
import { TagVisitRedirect } from "@/components/checkout/tag-visit-redirect"
import { BadgeOfferCoordinator } from "@/components/checkout/badge-offer-coordinator"

const wizardSearchSchema = z.object({
  picc: z.optional(z.string()),
  cmac: z.optional(z.string()),
  kiosk: z.optional(z.string()),
  /** Set by `/visit/add/*` redirects when a QR is scanned cold (no
   * open checkout). /checkin shows a "re-scan after check-in" banner. */
  rescan: z.optional(z.string()),
})

export const Route = createFileRoute("/_wizard")({
  validateSearch: wizardSearchSchema,
  component: WizardLayout,
})

/**
 * Map the current URL path to the wizard's step index (0..3). Anything
 * outside the four routes returns null so the progress indicator hides.
 */
function stepForPathname(pathname: string): number | null {
  if (pathname.startsWith("/checkin")) return 0
  if (pathname.startsWith("/visit")) return 1
  if (pathname.startsWith("/checkout")) return 2
  if (pathname.startsWith("/payment")) return 3
  return null
}

function WizardLayout() {
  const auth = useFirebaseAuth()
  const { userDoc, loading, userDocLoading, sessionKind } = useAuth()
  const { picc, cmac, kiosk } = Route.useSearch()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isKiosk = kiosk !== undefined
  const { data: pricingConfig, loading: loadingConfig, configError } =
    usePricingConfig()

  // Clear any stale Firebase Auth session on mount in kiosk mode with no
  // tag params — the kiosk chrome "neuer checkout" navigates here without
  // picc/cmac and the previous tag session must be wiped.
  useEffect(() => {
    if (isKiosk && !picc && !cmac) {
      signOut(auth)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redirect logged-in users with incomplete profiles to /account/complete-profile.
  // Tag-auth sessions always carry picc/cmac — skip them.
  const isAccountLoggedIn = sessionKind === "real" && !picc
  const profileLoading = loading || userDocLoading
  const needsProfileCompletion =
    isAccountLoggedIn &&
    !profileLoading &&
    userDoc &&
    !isProfileComplete(userDoc)

  useEffect(() => {
    if (needsProfileCompletion) {
      navigate({
        to: "/account/complete-profile",
        search: { redirect: pathname },
      })
    }
  }, [needsProfileCompletion, navigate, pathname])

  if (isAccountLoggedIn && profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (needsProfileCompletion) return null

  if (loadingConfig) return <PageLoading />

  if (configError || !pricingConfig) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Konfigurationsfehler"
        description={
          configError
            ? `Preiskonfiguration ungültig: ${configError}. Bitte Admin kontaktieren.`
            : "Preiskonfiguration konnte nicht geladen werden. Bitte Admin kontaktieren."
        }
      />
    )
  }

  const headerName = userDoc?.name || null

  return (
    <WizardProvider
      picc={picc}
      cmac={cmac}
      kiosk={isKiosk}
      pricingConfig={pricingConfig}
    >
      <WizardChrome headerName={headerName} userId={userDoc?.id} />
      <KioskInactivityWatcher />
      <TagAuthOverlay />
      <TagVisitRedirect />
      <BadgeOfferCoordinator />
    </WizardProvider>
  )
}

/**
 * Renders the wizard chrome (header, "Self-Checkout" title, progress
 * indicator, stale banner, current step via Outlet) OR — when the
 * visitor lands directly on /visit /checkout /payment without an open
 * checkout — strips the chrome and shows the NoCheckoutGate dialog
 * against a blank page. The progress indicator is intentionally hidden
 * for that case: there's no step to be "on" yet.
 */
function WizardChrome({
  headerName,
  userId,
}: {
  headerName: string | null
  userId?: string
}) {
  const { pathname } = useLocation()
  const { openCheckout, pendingCheckout, paymentData } = useWizardContext()
  const currentStep = stepForPathname(pathname)

  const gateableRoute =
    pathname.startsWith("/visit") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/payment")
  // pendingCheckout is true between /checkin's "Weiter" creating a
  // fresh doc and the onSnapshot listener surfacing it — without this
  // check /visit would briefly flash the no-checkout gate.
  //
  // /payment's transition closes the checkout (status flips open →
  // closed, so it falls out of the open-checkout query). paymentData
  // is the post-submit handoff — when set on /payment, the user is
  // legitimately on the payment screen and must not be gated.
  const justSubmittedPayment =
    pathname.startsWith("/payment") && !!paymentData
  const showGate =
    gateableRoute && !openCheckout && !pendingCheckout && !justSubmittedPayment

  return (
    <div className="min-h-screen flex flex-col items-center bg-background">
      <header className="w-full bg-background border-b border-border">
        <div className="w-full max-w-[1000px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-12 shrink-0"
          />
          {headerName && (
            <Link
              to="/account/usage"
              className="flex items-center gap-3 min-w-0 rounded-full -m-1 p-1 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-cog-teal/40 focus-visible:outline-offset-2 transition-colors"
              aria-label="Nutzungsverlauf öffnen"
            >
              <span className="text-sm text-foreground truncate">
                {headerName}
              </span>
              <Avatar name={headerName} seed={userId} />
            </Link>
          )}
          {/* Anon escape hatch — self-gates to anon + open checkout, so it's
              mutually exclusive with the signed-in identity above and absent
              on a fresh /checkin and on /payment (closed checkout). */}
          <StartOverButton />
        </div>
      </header>
      {showGate ? (
        // Intentionally blank below the header — only the modal dialog
        // is meaningful when there's no checkout to act on.
        <NoCheckoutGate />
      ) : (
        <div className="w-full max-w-[1000px] px-4 sm:px-6 py-6 flex-1 flex flex-col">
          <h1 className="text-2xl sm:text-[37px] font-bold mb-6">
            Self-Checkout
          </h1>
          {currentStep != null && <CheckoutProgress currentStep={currentStep} />}
          <StaleCheckoutBanner />
          <Outlet />
        </div>
      )}
    </div>
  )
}
