// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shared sidebar+main shell used by both web apps' authenticated routes.
// Each app supplies its own nav items and a redirect "gate" (admin-only
// vs member-with-profile-completion). Hooks deliberately sit above the
// loading early-return — see regression test for React error #310.

import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { Avatar } from "@modules/components/ui/avatar"
import { Button } from "@modules/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@modules/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@modules/components/ui/tooltip"
import { Loader2, LogOut, Menu, type LucideIcon } from "lucide-react"

export interface AuthenticatedLayoutNavItem {
  to: string
  label: string
  icon: LucideIcon
  /**
   * When true this item renders as the solid-teal primary call-to-action
   * (the "start/go to visit" idiom) rather than a regular nav row. The
   * solid fill is reserved exclusively for the primary action so it can't
   * be confused with the subtle "current page" active style (issue #363).
   * The admin sidebar has no primary action and leaves this unset.
   */
  primary?: boolean
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
  /**
   * Optional ReactNode rendered prominently above the sidebar nav items
   * — used by the checkout app for the state-aware "Mein Besuch" /
   * "Neuer Besuch" CTA. Pass null to hide.
   */
  headerAction?: ReactNode
  /**
   * Where to send the user after an explicit "Abmelden". When set, the
   * logout button navigates here (a public page) instead of letting the
   * unauth gate bounce to `/login?redirect=<member-path>` — which would
   * strand a just-logged-out user on the login screen with no way out.
   * The checkout app passes `/checkin`; the admin app omits it (login is
   * the right place for a logged-out admin).
   */
  signOutRedirect?: string
}

export function AuthenticatedLayout({
  navItems,
  gate,
  wrapper: Wrapper,
  headerAction,
  signOutRedirect,
}: AuthenticatedLayoutProps) {
  const { user, userDoc, isAdmin, loading, userDocLoading, signOut, sessionKind } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Hooks must be called unconditionally before any early returns.
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Redirect to login if not authenticated. Preserve the current pathname
  // through `?redirect=` so an unauthenticated visitor who clicked a deep
  // link (e.g. an emailed invite) lands back where they intended after
  // signing in. Mirrors the anonymous-session branch below — the ref
  // guard prevents a re-fire after `location.pathname` flips to "/login"
  // before the layout unmounts. A genuine remount (signed-out tab returns)
  // resets the ref and re-redirects, which is the right behavior.
  const unauthRedirectedRef = useRef(false)
  useEffect(() => {
    if (!loading && !user && !unauthRedirectedRef.current) {
      unauthRedirectedRef.current = true
      ;(navigate as (opts: { to: string; search?: Record<string, unknown> }) => void)({
        to: "/login",
        search: { redirect: location.pathname },
      })
    }
  }, [user, loading, navigate, location.pathname])

  // Admin gate: kick non-admins back to login once user doc has loaded.
  // Note: anonymous principals are filtered out implicitly here because
  // `isAdmin` is false for them, so no separate branch is needed.
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

  // Member gate: anonymous Firebase principals (eager-anon checkout flow)
  // must not reach member-area routes either. Bounce to /login with a
  // redirect back to the current path so a successful upgrade lands them
  // where they tried to go. The "have we already redirected" ref avoids a
  // re-fire after `location.pathname` updates to "/login" (TanStack Router
  // commits the path change before unmounting this layout).
  const anonRedirectedRef = useRef(false)
  useEffect(() => {
    if (gate.kind !== "member") return
    if (!loading && sessionKind === "anonymous" && !anonRedirectedRef.current) {
      anonRedirectedRef.current = true
      // The typed `navigate` from the registered router may not statically
      // accept a `search.redirect` field on /login (each app has its own
      // search schema). Cast away the typed route check; the calling app
      // wires `?redirect=` parsing in its login route file.
      ;(navigate as (opts: { to: string; search?: Record<string, unknown> }) => void)({
        to: "/login",
        search: { redirect: location.pathname },
      })
    }
  }, [gate, sessionKind, loading, navigate, location.pathname])

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
  if (gate.kind === "member" && (sessionKind === "tag" || sessionKind === "anonymous")) return null

  // A left accent border is reserved for the active item; inactive items
  // carry a transparent border of the same width so the row geometry stays
  // identical and the label doesn't shift on activation.
  const navLink =
    "flex items-center gap-2.5 border-l-2 border-transparent px-3 py-2 rounded-[3px] text-sm transition-colors"
  // Active = "you are here": a SUBTLE pale tint, dark-teal text and a left
  // accent border — deliberately NOT the solid teal fill, which is reserved
  // for the primary visit CTA (the `headerAction`). Solid-on-solid made the
  // current page and the call-to-action indistinguishable (issue #363).
  const navLinkActive =
    "[&.active]:bg-cog-teal-light [&.active]:text-cog-teal-dark [&.active]:font-semibold [&.active]:border-cog-teal"
  // Hover only tints inactive rows; the active row keeps its pale tint so a
  // hover doesn't wash out the "current page" signal.
  const navLinkHover = "hover:bg-cog-teal-light/60 [&.active]:hover:bg-cog-teal-light"
  // Primary item = solid-teal CTA. Overrides the subtle active style so the
  // call-to-action always reads as a button, never as the current page.
  const navLinkPrimary =
    "bg-cog-teal text-white font-bold hover:bg-cog-teal-dark [&.active]:bg-cog-teal [&.active]:text-white [&.active]:hover:bg-cog-teal-dark"

  const navContent = (
    <>
      {headerAction && (
        <div className="mb-3" onClick={() => setSheetOpen(false)}>
          {headerAction}
        </div>
      )}
      {navItems.map(({ to, label, icon: Icon, primary }) => (
        <Link
          key={to}
          to={to}
          className={
            primary
              ? `${navLink} ${navLinkPrimary}`
              : `${navLink} ${navLinkActive} ${navLinkHover}`
          }
          onClick={() => setSheetOpen(false)}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}

      <div className="mt-auto border-t border-sidebar-border pt-3 pb-2">
        <div className="flex items-center gap-2.5 px-3 py-1.5">
          <Avatar
            name={userDoc?.name || user.email || "?"}
            seed={user.uid}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">
              {userDoc?.name || user.email}
            </div>
            {userDoc?.name && user.email ? (
              <div className="text-xs text-muted-foreground truncate">
                {user.email}
              </div>
            ) : null}
          </div>
          {/* Icon-only sign-out button — collapses the previously full-width
              "Abmelden" CTA into the avatar row so the leading edges line up
              (issue #232). `aria-label` keeps screen readers happy when the
              visible text disappears; the tooltip surfaces the label on
              hover/focus for sighted users. */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Abmelden"
                  className="text-muted-foreground hover:text-foreground hover:bg-cog-teal-light"
                  onClick={() => {
                    // Navigate to the public landing FIRST (before signOut
                    // flips `user` to null) so leaving the _authenticated
                    // subtree unmounts the unauth gate — otherwise it bounces
                    // to /login?redirect=<member-path> and strands the user.
                    if (signOutRedirect) {
                      ;(navigate as (opts: { to: string }) => void)({
                        to: signOutRedirect,
                      })
                    }
                    void signOut()
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Abmelden</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </>
  )

  const shell = (
    <div className="min-h-screen flex flex-col md:h-screen md:flex-row md:overflow-hidden">
      {/* Mobile header */}
      {isMobile && (
        <header className="flex items-center gap-3 px-4 py-3 border-b border-sidebar-border bg-sidebar">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="p-1.5">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-60 p-0 bg-sidebar text-sidebar-foreground flex flex-col">
              <SheetTitle className="p-4 pb-2">
                <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-10" />
              </SheetTitle>
              <div className="px-3 py-2 flex flex-col gap-0.5 flex-1 overflow-y-auto">{navContent}</div>
            </SheetContent>
          </Sheet>
          <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-8" />
        </header>
      )}

      {/* Desktop sidebar — pinned to viewport so footer stays visible
          regardless of main-content length. */}
      {!isMobile && (
        <nav className="w-60 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border md:sticky md:top-0 md:h-screen md:shrink-0">
          <div className="p-4 pb-2">
            <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-10" />
          </div>
          <div className="px-3 py-2 flex flex-col gap-0.5 flex-1 overflow-y-auto">{navContent}</div>
        </nav>
      )}

      {/* Main content owns the page-level scroll on md+ so the sidebar stays put. */}
      <main className="flex-1 p-4 md:p-8 bg-background md:h-screen md:overflow-auto">
        <Outlet />
      </main>
    </div>
  )

  return Wrapper ? <Wrapper>{shell}</Wrapper> : shell
}
