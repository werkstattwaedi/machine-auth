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
import { WizardProvider } from "@/components/checkout/wizard-context"
import { CheckoutProgress } from "@/components/checkout/checkout-progress"
import { StaleCheckoutBanner } from "@/components/checkout/stale-checkout-banner"
import { KioskInactivityWatcher } from "@/components/checkout/kiosk-inactivity-watcher"

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
  const currentStep = stepForPathname(pathname)

  return (
    <WizardProvider
      picc={picc}
      cmac={cmac}
      kiosk={isKiosk}
      pricingConfig={pricingConfig}
    >
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
                to="/account/profile"
                className="flex items-center gap-3 min-w-0 rounded-full -m-1 p-1 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-cog-teal/40 focus-visible:outline-offset-2 transition-colors"
                aria-label="Profil öffnen"
              >
                <span className="text-sm text-foreground truncate">
                  {headerName}
                </span>
                <Avatar name={headerName} seed={userDoc?.id} />
              </Link>
            )}
          </div>
        </header>
        <div className="w-full max-w-[1000px] px-4 sm:px-6 py-6 flex-1 flex flex-col">
          <h1 className="text-2xl sm:text-[37px] font-bold mb-6">
            Self-Checkout
          </h1>
          {currentStep != null && <CheckoutProgress currentStep={currentStep} />}
          <StaleCheckoutBanner />
          <Outlet />
        </div>
        <KioskInactivityWatcher />
      </div>
    </WizardProvider>
  )
}
