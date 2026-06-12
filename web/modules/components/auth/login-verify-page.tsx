// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shared magic-link redemption page. Both apps mount this at /login/verify
// (via login_.verify.tsx). After redeeming the link (which proves the e-mail),
// it routes by account state:
//  - completed account → land on defaultRedirect
//  - new account (signupEnabled, no accepted terms) → open the combined login
//    page directly in the inline sign-up form (?signup=1), same as the Galaxus
//    "click the link → finish creating your account" flow. The link carries a
//    docId (not the 6-digit code), so we redeem server-side and skip the code
//    field rather than trying to prefill it.

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { AlertCircle, Loader2 } from "lucide-react"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"

export interface LoginVerifyPageProps {
  /** Magic-link token from the URL ?token= search param. */
  token: string | undefined
  /** Where to land after redemption when the account is complete. */
  defaultRedirect: string
  /** When true, route new accounts into the inline sign-up form. */
  signupEnabled?: boolean
}

export function LoginVerifyPage({
  token,
  defaultRedirect,
  signupEnabled = false,
}: LoginVerifyPageProps) {
  const { completeMagicLink, user, userDoc, userDocLoading, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [redeemed, setRedeemed] = useState(false)
  // Guards React StrictMode's double-invoke so the token isn't redeemed twice.
  const redeemedRef = useRef(false)
  // Guards against double navigation once routing fires.
  const routedRef = useRef(false)

  useEffect(() => {
    if (!token) {
      setError("Kein Token in der URL.")
      return
    }
    if (redeemedRef.current) return
    redeemedRef.current = true

    completeMagicLink(token)
      .then(() => {
        toast.success("Erfolgreich angemeldet")
        setRedeemed(true)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Link ungültig."
        setError(message)
      })
  }, [token, completeMagicLink])

  // Route by account state once redeemed and the user doc has resolved.
  useEffect(() => {
    if (!redeemed || error || routedRef.current) return
    if (loading || !user || userDocLoading) return
    routedRef.current = true

    if (signupEnabled && !(userDoc && isProfileComplete(userDoc))) {
      // New / incomplete account → finish sign-up inline on /login.
      ;(navigate as (opts: { to: string; search?: Record<string, string> }) => void)({
        to: "/login",
        search: { signup: "1" },
      })
      return
    }
    navigate({ to: defaultRedirect })
  }, [
    redeemed,
    error,
    loading,
    user,
    userDoc,
    userDocLoading,
    signupEnabled,
    navigate,
    defaultRedirect,
  ])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="border border-border rounded p-6 space-y-4 text-center">
          {error ? (
            <>
              <AlertCircle className="h-10 w-10 mx-auto text-red-600" />
              <p className="text-sm">{error}</p>
              <Button onClick={() => navigate({ to: "/login" })} className="w-full">
                Zurück zur Anmeldung
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 mx-auto animate-spin text-cog-teal" />
              <p className="text-sm text-muted-foreground">Anmeldung wird abgeschlossen…</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
