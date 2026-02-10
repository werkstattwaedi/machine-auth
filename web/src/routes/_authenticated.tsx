// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, Link, useNavigate, useMatches } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Loader2, LogOut, Home, User, Shield, ClipboardList, History, Cpu, Key, Monitor, Receipt, Package, FileText } from "lucide-react"
import { useEffect } from "react"

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user, userDoc, isAdmin, loading, userDocLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const matches = useMatches()

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" })
    }
  }, [user, loading, navigate])

  // Terms acceptance gate - redirect to /terms if terms not accepted
  // (skip if already on the terms page, wait for userDoc to load)
  const isOnTermsPage = matches.some((m) => m.fullPath === "/terms")
  useEffect(() => {
    if (!loading && !userDocLoading && userDoc && !userDoc.termsAcceptedAt && !isOnTermsPage) {
      navigate({ to: "/terms" })
    }
  }, [loading, userDocLoading, userDoc, isOnTermsPage, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <nav className="w-56 border-r bg-sidebar text-sidebar-foreground p-4 flex flex-col gap-1">
        <h2 className="font-semibold text-sm mb-4 px-2">OWW Maschinen</h2>

        <Link to="/" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
          <Home className="h-4 w-4" />
          Aktueller Besuch
        </Link>

        <Link to="/profile" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
          <User className="h-4 w-4" />
          Profil
        </Link>

        <Link to="/usage" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
          <History className="h-4 w-4" />
          Nutzungsverlauf
        </Link>

        {isAdmin && (
          <>
            <div className="mt-4 mb-2 px-2 text-xs font-medium text-muted-foreground uppercase">
              Admin
            </div>
            <Link to="/users" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <Shield className="h-4 w-4" />
              Benutzer
            </Link>
            <Link to="/machines" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <Cpu className="h-4 w-4" />
              Maschinen
            </Link>
            <Link to="/permissions" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <Key className="h-4 w-4" />
              Berechtigungen
            </Link>
            <Link to="/terminals" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <Monitor className="h-4 w-4" />
              Terminals
            </Link>
            <Link to="/sessions" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <ClipboardList className="h-4 w-4" />
              Sitzungen
            </Link>
            <Link to="/checkouts" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <Receipt className="h-4 w-4" />
              Checkouts
            </Link>
            <Link to="/materials" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <Package className="h-4 w-4" />
              Materialien
            </Link>
            <Link to="/audit" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm [&.active]:bg-sidebar-accent">
              <FileText className="h-4 w-4" />
              Audit Log
            </Link>
          </>
        )}

        <div className="mt-auto">
          <div className="px-2 py-1 text-xs text-muted-foreground truncate">
            {userDoc?.displayName ?? user.email}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Abmelden
          </Button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
