// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Filename: the trailing underscore on `login_` is a TanStack Router
// convention that makes this a *sibling* of `/login` rather than a child
// nested inside its Outlet. URL stays `/login/verify`. Without the
// underscore, this component would render inside login.tsx's layout.
// See https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { z } from "zod/v4/mini"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"

const verifySearchSchema = z.object({
  token: z.optional(z.string()),
})

export const Route = createFileRoute("/login_/verify")({
  validateSearch: verifySearchSchema,
  component: VerifyMagicLinkPage,
})

function VerifyMagicLinkPage() {
  const { token } = Route.useSearch()
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
        navigate({ to: "/users" })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Link ungültig."
        setError(message)
      })
  }, [token, completeMagicLink, navigate])

  useEffect(() => {
    if (!loading && user && !error) {
      navigate({ to: "/users" })
    }
  }, [user, loading, error, navigate])

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
