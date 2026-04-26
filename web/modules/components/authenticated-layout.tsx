// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shared sidebar+main shell used by both web apps' authenticated routes.
// Each app supplies its own nav items and a redirect "gate" (admin-only
// vs member-with-profile-completion). Hooks deliberately sit above the
// loading early-return — see regression test for React error #310.

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { Button } from "@modules/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@modules/components/ui/sheet"
import { Loader2, LogOut, Menu, type LucideIcon } from "lucide-react"

export interface AuthenticatedLayoutNavItem {
  to: string
  label: string
  icon: LucideIcon
}

export type AuthenticatedLayoutGate =
  | { kind: "admin" }
  | { kind: "member"; completeProfilePath: string }

export interface AuthenticatedLayoutProps {
  navItems: AuthenticatedLayoutNavItem[]
  gate: AuthenticatedLayoutGate
  /**
   * Optional wrapper around the rendered shell — used by the admin app to
   * mount LookupProvider above the content tree.
   */
  wrapper?: (props: { children: ReactNode }) => ReactNode
}

export function AuthenticatedLayout({
  navItems,
  gate,
  wrapper: Wrapper,
}: AuthenticatedLayoutProps) {
  const { user, userDoc, isAdmin, loading, userDocLoading, signOut, sessionKind } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Hooks must be called unconditionally before any early returns.
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" })
    }
  }, [user, loading, navigate])

  // Admin gate: kick non-admins back to login once user doc has loaded.
  useEffect(() => {
    if (gate.kind !== "admin") return
    if (!loading && !userDocLoading && user && !isAdmin) {
      navigate({ to: "/login" })
    }
  }, [gate, user, isAdmin, loading, userDocLoading, navigate])

  // Member gate: tag-tap (kiosk) sessions are scoped to the checkout flow
  // and must never reach member-area routes; bounce to kiosk root.
  useEffect(() => {
    if (gate.kind !== "member") return
    if (!loading && sessionKind === "tag") {
      navigate({ to: "/" })
    }
  }, [gate, sessionKind, loading, navigate])

  // Member gate: redirect to profile-completion when the profile is incomplete.
  useEffect(() => {
    if (gate.kind !== "member") return
    if (!loading && !userDocLoading && userDoc && !isProfileComplete(userDoc)) {
      // The completeProfilePath is supplied by the consuming app, so the
      // typed `navigate` from the registered router can't statically prove
      // the destination exists in *this* app's tree. Cast away the typed
      // route check; runtime correctness is ensured by the app's config.
      ;(navigate as (opts: { to: string; search?: Record<string, unknown> }) => void)({
        to: gate.completeProfilePath,
        search: { redirect: location.pathname },
      })
    }
  }, [gate, loading, userDocLoading, userDoc, navigate, location.pathname])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user) return null
  if (gate.kind === "admin" && !isAdmin) return null
  if (gate.kind === "member" && sessionKind === "tag") return null

  const navLink =
    "flex items-center gap-2.5 px-3 py-2 rounded-[3px] text-sm transition-colors"
  const navLinkActive =
    "[&.active]:bg-cog-teal [&.active]:text-white [&.active]:font-semibold"
  const navLinkHover = "hover:bg-cog-teal-light"

  const navContent = (
    <>
      {navItems.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className={`${navLink} ${navLinkActive} ${navLinkHover}`}
          onClick={() => setSheetOpen(false)}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}

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
    </>
  )

  const shell = (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Mobile header */}
      {isMobile && (
        <header className="flex items-center gap-3 px-4 py-3 border-b border-sidebar-border bg-sidebar">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="p-1.5">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-60 p-0 bg-sidebar text-sidebar-foreground">
              <SheetTitle className="p-4 pb-2">
                <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-10" />
              </SheetTitle>
              <div className="px-3 py-2 flex flex-col gap-0.5 flex-1">{navContent}</div>
            </SheetContent>
          </Sheet>
          <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-8" />
        </header>
      )}

      {/* Desktop sidebar */}
      {!isMobile && (
        <nav className="w-60 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
          <div className="p-4 pb-2">
            <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-10" />
          </div>
          <div className="px-3 py-2 flex flex-col gap-0.5 flex-1">{navContent}</div>
        </nav>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 md:p-8 bg-background overflow-auto">
        <Outlet />
      </main>
    </div>
  )

  return Wrapper ? <Wrapper>{shell}</Wrapper> : shell
}
