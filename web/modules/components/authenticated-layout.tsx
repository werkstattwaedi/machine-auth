// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shared header + sidebar + main shell used by both web apps' authenticated
// routes. Each app supplies its own nav items and a redirect "gate"
// (admin-only vs member-with-profile-completion). The header and its menu
// are the same `AppHeader` / `AppMenu` the checkout wizard uses (#729). Hooks deliberately sit above the
// loading early-return — see regression test for React error #310.

import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { Button } from "@modules/components/ui/button"
import { AppHeader } from "@modules/components/app-header/app-header"
import {
  AppMenu,
  navLinkClass,
  type AppMenuEntry,
} from "@modules/components/app-header/app-menu"
import { Loader2, LogOut, type LucideIcon } from "lucide-react"

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
   * (and above them in the mobile menu sheet) — used by the checkout app
   * for the state-aware "Mein Besuch" / "Neuer Besuch" CTA. Pass null to
   * hide.
   */
  headerAction?: ReactNode
  /**
   * Desktop header-menu entries before "Problem melden" — the checkout
   * passes Profil / Nutzungsverlauf / Mitgliedschaft so the member-area menu
   * matches the wizard's. The admin menu has none.
   */
  menuItems?: AppMenuEntry[]
  /**
   * Where to send the user after an explicit "Abmelden". When set, the
   * logout button navigates here (a public page) instead of letting the
   * unauth gate bounce to `/login?redirect=<member-path>` — which would
   * strand a just-logged-out user on the login screen with no way out.
   * The checkout app passes `/checkin`; the admin app omits it (login is
   * the right place for a logged-out admin).
   */
  signOutRedirect?: string
  /**
   * Kiosk mode (ADR-0041): the checkout app passes this when running inside
   * the Electron bridge. An OTP-elevated kiosk session may browse the
   * member area; "Abmelden" then runs `onSignOut` (the strong start-over
   * wipe) instead of a plain sign-out + redirect. The visit CTA in
   * `headerAction` is the way back to the checkout.
   */
  kiosk?: {
    onSignOut: () => void
  }
}

export function AuthenticatedLayout({
  navItems,
  gate,
  wrapper: Wrapper,
  headerAction,
  menuItems,
  signOutRedirect,
  kiosk,
}: AuthenticatedLayoutProps) {
  const {
    user,
    userDoc,
    isAdmin,
    loading,
    userDocLoading,
    signOut,
    sessionKind,
    isKioskElevated,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Hooks must be called unconditionally before any early returns.
  const isMobile = useIsMobile()

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

  // Admin gate: an authenticated non-admin is NOT redirected. Bouncing them
  // to /login created an endless loop (issue #558): /login sees a signed-in
  // principal and redirects back to the protected route, which bounces to
  // /login again — forever, with no message. Instead we render a terminal
  // "Kein Admin-Zugriff" state below so the user learns why and can sign out.

  // Member gate: a kiosk tag session reaches member-area routes ONLY while
  // OTP-elevated (ADR-0041). Un-elevated — a bare badge tap, or an elevation
  // that just expired mid-page — bounces back to the kiosk check-in.
  const tagBlocked = sessionKind === "tag" && !isKioskElevated
  useEffect(() => {
    if (gate.kind !== "member") return
    if (!loading && tagBlocked) {
      ;(navigate as (opts: { to: string; search?: Record<string, unknown> }) => void)({
        to: "/checkin",
        search: { kiosk: "" },
      })
    }
  }, [gate, tagBlocked, loading, navigate])

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
  if (gate.kind === "admin") {
    // Wait for the user doc before judging admin-ness — isAdmin is false
    // while the doc loads, and rendering the "no access" state in that
    // window would flash it for legitimate admins.
    if (userDocLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )
    }
    if (!isAdmin) {
      // Terminal state: signed in but not an admin. No redirect — see the
      // comment on the removed admin-gate effect above (issue #558).
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="w-full max-w-sm text-center flex flex-col items-center gap-4">
            <img
              src="/logo_oww.png"
              alt="Offene Werkstatt Wädenswil"
              className="h-12 mb-2"
            />
            <h1 className="font-heading font-bold text-[24px] leading-tight">
              Kein Admin-Zugriff
            </h1>
            <p className="text-sm text-muted-foreground">
              {user.email ? (
                <>
                  Das Konto <span className="font-medium">{user.email}</span> hat
                  keine Administratorrechte.
                </>
              ) : (
                <>Dieses Konto hat keine Administratorrechte.</>
              )}{" "}
              Melde dich mit einem Administrator-Konto an.
            </p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => void signOut()}
            >
              <LogOut className="h-4 w-4" />
              Abmelden
            </Button>
          </div>
        </div>
      )
    }
  }
  if (gate.kind === "member" && (tagBlocked || sessionKind === "anonymous")) return null

  const handleSignOut = () => {
    // Kiosk: the strong wipe (signOut + partition reset + hard reload) —
    // nothing of this visitor may survive on the shared terminal.
    if (kiosk) {
      kiosk.onSignOut()
      return
    }
    // Navigate to the public landing FIRST (before signOut flips `user` to
    // null) so leaving the _authenticated subtree unmounts the unauth gate —
    // otherwise it bounces to /login?redirect=<member-path> and strands the
    // user.
    if (signOutRedirect) {
      ;(navigate as (opts: { to: string }) => void)({ to: signOutRedirect })
    }
    void signOut()
  }

  const shell = (
    // `data-app-shell` marks the authenticated header+sidebar+main shell so
    // global CSS can disable the reserved document scrollbar gutter here: the
    // page scroll lives inside `<main>`, not the document, so the viewport
    // gutter (#568) would only inset empty strips beside the sidebar (#581).
    <div
      data-app-shell
      className="min-h-screen flex flex-col md:h-screen md:overflow-hidden"
    >
      <AppHeader
        width="full"
        menu={
          <AppMenu
            identity={{
              name: userDoc?.name || user.email || userDoc?.email || "?",
              // The doc's e-mail stands in for a kiosk principal's missing one.
              email: user.email || userDoc?.email || null,
              userId: user.uid,
            }}
            menuItems={menuItems}
            navItems={navItems}
            headerAction={headerAction}
            onSignOut={handleSignOut}
          />
        }
      />

      <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
        {/* Desktop sidebar below the header; on mobile the menu sheet
            carries the same navigation. */}
        {!isMobile && (
          <nav className="w-60 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground">
            <div className="flex flex-col gap-0.5">
              {headerAction && <div className="mb-3">{headerAction}</div>}
              {navItems.map(({ to, label, icon: Icon, primary }) => (
                <Link key={to} to={to} className={navLinkClass(primary)}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        )}

        {/* Main content owns the page-level scroll on md+ so the header and
            sidebar stay put. */}
        <main className="flex-1 p-4 md:p-8 bg-background md:overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )

  return Wrapper ? <Wrapper>{shell}</Wrapper> : shell
}
