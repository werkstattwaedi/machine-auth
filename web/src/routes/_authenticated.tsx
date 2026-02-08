// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Loader2, LogOut, Home, User, Shield } from "lucide-react"

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user, userDoc, isAdmin, loading, signOut } = useAuth()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!user) {
    navigate({ to: "/login" })
    return null
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <nav className="w-56 border-r bg-sidebar text-sidebar-foreground p-4 flex flex-col gap-1">
        <h2 className="font-semibold text-sm mb-4 px-2">OWW Maschinen</h2>

        <Link to="/" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm">
          <Home className="h-4 w-4" />
          Dashboard
        </Link>

        <Link to="/profile" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm">
          <User className="h-4 w-4" />
          Profil
        </Link>

        {isAdmin && (
          <>
            <div className="mt-4 mb-2 px-2 text-xs font-medium text-muted-foreground uppercase">
              Admin
            </div>
            <Link to="/users" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm">
              <Shield className="h-4 w-4" />
              Benutzer
            </Link>
            <Link to="/machines" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm">
              Maschinen
            </Link>
            <Link to="/permissions" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm">
              Berechtigungen
            </Link>
            <Link to="/sessions" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sidebar-accent text-sm">
              Sitzungen
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
