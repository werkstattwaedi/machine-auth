// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { LookupProvider } from "@modules/lib/lookup"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { Button } from "@modules/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@modules/components/ui/sheet"
import { Loader2, LogOut, Shield, Cpu, Key, Monitor, ClipboardList, Receipt, Package, List, FileText, Menu } from "lucide-react"
import { useState, useEffect } from "react"

export const Route = createFileRoute("/_authenticated")({
  component: AdminAuthenticatedLayout,
})

function AdminAuthenticatedLayout() {
  const { user, userDoc, isAdmin, loading, userDocLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

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

  const navContent = (
    <>
      <Link to="/users" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <Shield className="h-4 w-4" />
        Benutzer
      </Link>
      <Link to="/machines" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <Cpu className="h-4 w-4" />
        Maschinen
      </Link>
      <Link to="/permissions" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <Key className="h-4 w-4" />
        Berechtigungen
      </Link>
      <Link to="/terminals" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <Monitor className="h-4 w-4" />
        Terminals
      </Link>
      <Link to="/sessions" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <ClipboardList className="h-4 w-4" />
        Sitzungen
      </Link>
      <Link to="/checkouts" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <Receipt className="h-4 w-4" />
        Checkouts
      </Link>
      <Link to="/materials" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <Package className="h-4 w-4" />
        Materialien
      </Link>
      <Link to="/price-lists" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
        <List className="h-4 w-4" />
        Preislisten
      </Link>
      <Link to="/audit" className={`${navLink} ${navLinkActive} ${navLinkHover}`} onClick={() => setSheetOpen(false)}>
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
    </>
  )

  return (
    <LookupProvider>
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
                <div className="px-3 py-2 flex flex-col gap-0.5 flex-1">
                  {navContent}
                </div>
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
            <div className="px-3 py-2 flex flex-col gap-0.5 flex-1">
              {navContent}
            </div>
          </nav>
        )}

        {/* Main content */}
        <main className="flex-1 p-4 md:p-8 bg-background overflow-auto">
          <Outlet />
        </main>
      </div>
    </LookupProvider>
  )
}
