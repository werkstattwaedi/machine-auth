// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { Loader2 } from "lucide-react"
import { useEffect } from "react"

export const Route = createFileRoute("/_authonly")({
  component: AuthOnlyLayout,
})

/**
 * Minimal authenticated layout — requires sign-in but renders NO sidebar.
 * Used for flows like profile completion where the full app chrome is premature.
 */
function AuthOnlyLayout() {
  const { user, loading, sessionKind } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" })
    }
  }, [user, loading, navigate])

  // Tag-tap (kiosk) sessions must never reach member-area screens — they
  // are scoped to the checkout flow only. Bounce back to the kiosk root.
  useEffect(() => {
    if (!loading && sessionKind === "tag") {
      navigate({ to: "/" })
    }
  }, [sessionKind, loading, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user || sessionKind === "tag") return null

  return (
    <div className="min-h-screen flex flex-col items-center bg-background">
      <header className="w-full px-4 sm:px-6 pt-6 pb-2">
        <div className="w-full max-w-lg mx-auto">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-14"
          />
        </div>
      </header>
      <main className="w-full max-w-lg px-4 sm:px-6 py-4">
        <Outlet />
      </main>
    </div>
  )
}
