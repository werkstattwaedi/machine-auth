// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, Link, useNavigate, useMatches } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { Loader2, LogOut, Home, User, History } from "lucide-react"
import { useEffect } from "react"

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user, userDoc, loading, userDocLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const matches = useMatches()

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" })
    }
  }, [user, loading, navigate])

  // Profile completion gate - redirect to /complete-profile if profile not completed
  // (skip if already on the page, wait for userDoc to load)
  const isOnCompleteProfilePage = matches.some((m) => m.fullPath === "/complete-profile")
  useEffect(() => {
    if (!loading && !userDocLoading && userDoc && !userDoc.termsAcceptedAt && !isOnCompleteProfilePage) {
      navigate({ to: "/complete-profile" })
    }
  }, [loading, userDocLoading, userDoc, isOnCompleteProfilePage, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user) return null

  const navLink = "flex items-center gap-2.5 px-3 py-2 rounded-[3px] text-sm transition-colors"
  const navLinkActive = "[&.active]:bg-cog-teal [&.active]:text-white [&.active]:font-semibold"
  const navLinkHover = "hover:bg-cog-teal-light"

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <nav className="w-60 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        <div className="p-4 pb-2">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-10"
          />
        </div>

        <div className="px-3 py-2 flex flex-col gap-0.5 flex-1">
          <Link to="/visit" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
            <Home className="h-4 w-4" />
            Aktueller Besuch
          </Link>

          <Link to="/profile" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
            <User className="h-4 w-4" />
            Profil
          </Link>

          <Link to="/usage" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
            <History className="h-4 w-4" />
            Nutzungsverlauf
          </Link>

          <div className="mt-auto border-t border-sidebar-border pt-3 pb-2">
            <div className="px-3 py-1 text-xs text-muted-foreground truncate">
              {userDoc?.displayName ?? user.email}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-cog-teal-light"
              onClick={() => signOut()}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Abmelden
            </Button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-8 bg-background overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
