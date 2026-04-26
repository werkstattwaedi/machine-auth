// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { signOut } from "firebase/auth"
import { useFirebaseAuth } from "@modules/lib/firebase-context"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { CheckoutWizard } from "@/components/checkout/checkout-wizard"
import { ConfirmDialog } from "@modules/components/confirm-dialog"
import { Loader2 } from "lucide-react"

const checkoutSearchSchema = z.object({
  picc: z.optional(z.string()),
  cmac: z.optional(z.string()),
  kiosk: z.optional(z.string()),
  step: z.optional(z.string()),
})

export const Route = createFileRoute("/")({
  validateSearch: checkoutSearchSchema,
  component: CheckoutPage,
})

function CheckoutPage() {
  const auth = useFirebaseAuth()
  const { userDoc, loading, userDocLoading, sessionKind } = useAuth()
  const { picc, cmac, kiosk, step } = Route.useSearch()
  const isKiosk = kiosk !== undefined
  const navigate = useNavigate()

  // Track the "accepted" params that the wizard is actually using
  const [activeParams, setActiveParams] = useState<{
    picc?: string
    cmac?: string
  }>({ picc, cmac })

  // Pending params waiting for confirmation
  const [pendingParams, setPendingParams] = useState<{
    picc: string
    cmac: string
  } | null>(null)

  // Track whether checkout is in progress (step > 0 or pre-filled)
  const checkoutActiveRef = useRef(false)

  // Detect URL param changes after initial load
  const prevPiccRef = useRef(picc)
  const prevCmacRef = useRef(cmac)

  // Clear any stale Firebase Auth session on mount (e.g. kiosk chrome
  // "neuer checkout" navigates here without picc/cmac — the previous
  // tag session persists in IndexedDB and must be wiped)
  useEffect(() => {
    if (isKiosk && !picc && !cmac) {
      signOut(auth)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect logged-in users with incomplete profiles to complete-profile.
  // Tag-auth sessions always have picc/cmac in the URL — skip those.
  // Anonymous Firebase Auth sessions (sessionKind === "anonymous") look like
  // a logged-in user but have no userDoc; treating them as account-logged-in
  // would flip `profileLoading` true→false on submit and unmount the wizard.
  const isAccountLoggedIn = sessionKind === "real" && !picc
  const profileLoading = loading || userDocLoading
  const needsProfileCompletion =
    isAccountLoggedIn && !profileLoading && userDoc && !isProfileComplete(userDoc)

  useEffect(() => {
    if (needsProfileCompletion) {
      navigate({ to: "/complete-profile", search: { redirect: "/" } })
    }
  }, [needsProfileCompletion, navigate])

  useEffect(() => {
    const paramsChanged =
      picc !== prevPiccRef.current || cmac !== prevCmacRef.current
    prevPiccRef.current = picc
    prevCmacRef.current = cmac

    if (!paramsChanged || !picc || !cmac) return

    if (checkoutActiveRef.current) {
      // Checkout in progress — ask for confirmation
      setPendingParams({ picc, cmac })
    } else {
      // No active checkout — accept directly
      setActiveParams({ picc, cmac })
    }
  }, [picc, cmac])

  // Early returns — all hooks are above this point
  if (isAccountLoggedIn && profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (needsProfileCompletion) return null

  const handleConfirmNewTag = () => {
    if (pendingParams) {
      setActiveParams(pendingParams)
      setPendingParams(null)
    }
  }

  const handleCancelNewTag = () => {
    setPendingParams(null)
    // Revert URL to previous params
    navigate({
      to: "/",
      search: activeParams.picc
        ? { picc: activeParams.picc, cmac: activeParams.cmac }
        : {},
      replace: true,
    })
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-background">
      <header className="w-full bg-background px-4 sm:px-6 pt-6 pb-2">
        <div className="w-full max-w-[1000px] mx-auto">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-[93px]"
          />
        </div>
      </header>
      <div className="w-full max-w-[1000px] px-4 sm:px-6 py-4 flex-1 flex flex-col">
        <h1 className="text-2xl sm:text-[37px] font-bold mb-6">
          Self-Checkout
        </h1>
        <CheckoutWizard
          key={`${activeParams.picc ?? ""}-${activeParams.cmac ?? ""}`}
          picc={activeParams.picc}
          cmac={activeParams.cmac}
          kiosk={isKiosk}
          initialStep={step === "summary" ? 2 : undefined}
          onActiveChange={(active) => {
            checkoutActiveRef.current = active
          }}
        />
        <ConfirmDialog
          open={!!pendingParams}
          onOpenChange={(open) => {
            if (!open) handleCancelNewTag()
          }}
          title="Neuer Badge erkannt"
          description="Ein Checkout ist bereits in Bearbeitung. Neuen Checkout starten?"
          confirmLabel="Neuer Checkout"
          onConfirm={handleConfirmNewTag}
          destructive
        />
      </div>
    </div>
  )
}
