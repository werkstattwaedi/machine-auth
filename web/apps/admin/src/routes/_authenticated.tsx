// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { LookupProvider } from "@modules/lib/lookup"
import { Button } from "@modules/components/ui/button"
import { Loader2, LogOut, Shield, Cpu, Key, Monitor, ClipboardList, Receipt, Package, List, FileText } from "lucide-react"
import { useEffect } from "react"

export const Route = createFileRoute("/_authenticated")({
  component: AdminAuthenticatedLayout,
})

function AdminAuthenticatedLayout() {
  const { user, userDoc, isAdmin, loading, userDocLoading, signOut } = useAuth()
  const navigate = useNavigate()

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" })
    }
  }, [user, loading, navigate])

  // Redirect non-admins to login (wait for user doc to load first)
  useEffect(() => {
    if (!loading && !userDocLoading && user && !isAdmin) {
      navigate({ to: "/login" })
    }
  }, [user, isAdmin, loading, userDocLoading, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user || !isAdmin) return null

  const navLink = "flex items-center gap-2.5 px-3 py-2 rounded-[3px] text-sm transition-colors"
  const navLinkActive = "[&.active]:bg-cog-teal [&.active]:text-white [&.active]:font-semibold"
  const navLinkHover = "hover:bg-cog-teal-light"

  return (
    <LookupProvider>
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
            <Link to="/users" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <Shield className="h-4 w-4" />
              Benutzer
            </Link>
            <Link to="/machines" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <Cpu className="h-4 w-4" />
              Maschinen
            </Link>
            <Link to="/permissions" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <Key className="h-4 w-4" />
              Berechtigungen
            </Link>
            <Link to="/terminals" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <Monitor className="h-4 w-4" />
              Terminals
            </Link>
            <Link to="/sessions" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <ClipboardList className="h-4 w-4" />
              Sitzungen
            </Link>
            <Link to="/checkouts" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <Receipt className="h-4 w-4" />
              Checkouts
            </Link>
            <Link to="/materials" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <Package className="h-4 w-4" />
              Materialien
            </Link>
            <Link to="/price-lists" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <List className="h-4 w-4" />
              Preislisten
            </Link>
            <Link to="/audit" className={`${navLink} ${navLinkActive} ${navLinkHover}`}>
              <FileText className="h-4 w-4" />
              Audit Log
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
    </LookupProvider>
  )
}
