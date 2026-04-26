// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shared magic-link redemption page. Both apps mount this at /login/verify
// (via login_.verify.tsx). The only differences are:
//  - defaultRedirect: where to land after redemption succeeds
//  - signupEnabled: when true, honour loginRedirect / loginMode in localStorage
//    that the email-stage of LoginPage may have written

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { AlertCircle, Loader2 } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"

export interface LoginVerifyPageProps {
  /** Magic-link token from the URL ?token= search param. */
  token: string | undefined
  /** Where to land after a successful redemption when no localStorage hint applies. */
  defaultRedirect: string
  /** When true, honour loginRedirect / loginMode in localStorage. */
  signupEnabled?: boolean
  /** Where to send a sign-up flow user after redemption. Defaults to "/complete-profile". */
  signupRedirect?: string
}

export function LoginVerifyPage({
  token,
  defaultRedirect,
  signupEnabled = false,
  signupRedirect = "/complete-profile",
}: LoginVerifyPageProps) {
  const { completeMagicLink, user, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // Guards React StrictMode's double-invoke so the token isn't redeemed twice.
  const redeemedRef = useRef(false)

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
        let target = defaultRedirect
        if (signupEnabled) {
          const storedRedirect = window.localStorage.getItem("loginRedirect")
          const storedMode = window.localStorage.getItem("loginMode")
          window.localStorage.removeItem("loginRedirect")
          window.localStorage.removeItem("loginMode")
          const wasSignup = storedMode === "signup"
          target = wasSignup ? signupRedirect : (storedRedirect || defaultRedirect)
        }
        navigate({ to: target })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Link ungültig."
        setError(message)
      })
  }, [token, completeMagicLink, navigate, defaultRedirect, signupEnabled, signupRedirect])

  // If already signed in by the time we land here (e.g. user clicked link
  // in the same browser that also entered the code), just move on.
  useEffect(() => {
    if (!loading && user && !error) {
      navigate({ to: defaultRedirect })
    }
  }, [user, loading, error, navigate, defaultRedirect])

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
