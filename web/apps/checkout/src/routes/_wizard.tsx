// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState, useSyncExternalStore } from "react"
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { signOut } from "firebase/auth"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useFirebaseAuth } from "@modules/lib/firebase-context"
import { usePricingConfig } from "@modules/lib/workshop-config"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle, Loader2 } from "lucide-react"
import { WizardProvider, useWizardContext } from "@/components/checkout/wizard-context"
import { CheckoutProgress } from "@/components/checkout/checkout-progress"
import { StaleCheckoutBanner } from "@/components/checkout/stale-checkout-banner"
import { StartOverButton } from "@/components/checkout/start-over-button"
import { KioskInactivityWatcher } from "@/components/checkout/kiosk-inactivity-watcher"
import { NoCheckoutGate } from "@/components/checkout/no-checkout-gate"
import {
  getKioskTokenUser,
  subscribeKioskSession,
} from "@modules/lib/token-auth"
import { WelcomeOnboarding } from "@/components/account/welcome-onboarding"
import { KioskWelcomeOnboarding } from "@/components/account/kiosk-welcome-onboarding"
import { TagAuthOverlay } from "@/components/checkout/tag-auth-overlay"
import { TagVisitRedirect } from "@/components/checkout/tag-visit-redirect"
import { BadgeOfferCoordinator } from "@/components/checkout/badge-offer-coordinator"
import { AccountMenu } from "@/components/account/account-menu"

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
  const { user, userDoc, loading, userDocLoading, sessionKind } = useAuth()
  const { picc, cmac, kiosk } = Route.useSearch()
  const isKiosk = kiosk !== undefined
  const { data: pricingConfig, loading: loadingConfig, configError } =
    usePricingConfig()

  // Clear a stale REAL Firebase session on mount in kiosk mode — a
  // persistent login has no business on the shared terminal. A kiosk
  // (`tag:`) session is deliberately kept: since ADR-0041 the visitor
  // returns here from /account with their session intact, and the chrome's
  // "Neuer Checkout" wipes through startOver (signOut + partition reset)
  // rather than relying on this mount effect.
  useEffect(() => {
    const current = auth.currentUser
    if (isKiosk && !picc && !cmac && current && !current.uid.startsWith("tag:")) {
      signOut(auth)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Imported/incomplete members get the "Willkommen" onboarding as a blocking
  // overlay on top of the live checkout (not a redirect away). Tag-auth
  // sessions get the kiosk flavor below instead.
  const isAccountLoggedIn = sessionKind === "real" && !picc
  const profileLoading = loading || userDocLoading
  const needsOnboarding =
    isAccountLoggedIn &&
    !profileLoading &&
    userDoc &&
    !isProfileComplete(userDoc)

  // Latch so the overlay stays mounted through all four steps even after
  // step 3 records terms (which flips isProfileComplete). Cleared only when
  // the member finishes (onDone). Set during render (guarded) rather than in
  // an effect to avoid a cascading-render lint/perf hit.
  const [onboardingActive, setOnboardingActive] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(false)
  if (needsOnboarding && !onboardingActive) setOnboardingActive(true)
  const showOnboarding = onboardingActive && !onboardingDone

  // Kiosk flavor (issue #595): an unclaimed member's badge tap or email-code
  // sign-in establishes the actsAs session first; the wizard then runs the
  // same onboarding with callable-based persistence. The component reads the
  // user doc itself (tag sessions have no auth-context userDoc) and renders
  // null once the profile is complete.
  const kioskTokenUser = useSyncExternalStore(
    subscribeKioskSession,
    getKioskTokenUser,
  )

  if (isAccountLoggedIn && profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

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

  // Header identity: the account login's doc name, or — for a kiosk
  // session — the server-provided pre-fill name (no auth-context doc until
  // the session is elevated, ADR-0041).
  const headerName =
    userDoc?.name ||
    (sessionKind === "tag" && kioskTokenUser
      ? `${kioskTokenUser.firstName ?? ""} ${kioskTokenUser.lastName ?? ""}`.trim() || null
      : null)
  const headerUserId = userDoc?.id ?? kioskTokenUser?.userId
  const headerEmail =
    sessionKind === "tag"
      ? kioskTokenUser?.email ?? null
      : user?.email ?? userDoc?.email ?? null

  return (
    <WizardProvider
      picc={picc}
      cmac={cmac}
      kiosk={isKiosk}
      pricingConfig={pricingConfig}
    >
      <WizardChrome
        headerName={headerName}
        headerEmail={headerEmail}
        userId={headerUserId}
        kioskSession={sessionKind === "tag"}
      />
      <KioskInactivityWatcher />
      <TagAuthOverlay />
      <TagVisitRedirect />
      <BadgeOfferCoordinator />
      {showOnboarding && (
        <WelcomeOnboarding onDone={() => setOnboardingDone(true)} />
      )}
      {sessionKind === "tag" && kioskTokenUser && (
        <KioskWelcomeOnboarding
          key={kioskTokenUser.userId}
          userId={kioskTokenUser.userId}
        />
      )}
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
  headerEmail,
  userId,
  kioskSession,
}: {
  headerName: string | null
  headerEmail: string | null
  userId?: string
  /** True for a kiosk `actsAs` session: the header identity routes through
   *  the step-up dialog before opening the member area (ADR-0041). */
  kioskSession?: boolean
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
            className="h-[30px] shrink-0 sm:h-11"
          />
          {headerName && (
            <AccountMenu
              name={headerName}
              email={headerEmail}
              userId={userId}
              kioskSession={kioskSession}
            />
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
          <h1 className="text-[26px] sm:text-[37px] font-extrabold tracking-[-0.01em] mb-6">
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
