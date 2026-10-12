// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import {
  AuthenticatedLayout,
  type AuthenticatedLayoutNavItem,
} from "@modules/components/authenticated-layout"
import { BUILD_VERSION } from "@modules/lib/build-version"
import { LookupProvider } from "@modules/lib/lookup"
import {
  ClipboardList,
  Cpu,
  FileText,
  History,
  Package,
  Receipt,
  Server,
  Users,
} from "lucide-react"

export const Route = createFileRoute("/_authenticated")({
  component: AdminAuthenticatedLayout,
})

// Workflow-first nav: the four workspaces an admin starts a task in,
// then the shared secondary tables (deep-link targets). The nav does NOT
// mirror the database — supporting entities (memberships, permissions,
// terminals, price lists) live inside their workspace.
const navItems: AuthenticatedLayoutNavItem[] = [
  { to: "/users", label: "Personen", icon: Users },
  { to: "/machines", label: "Maschinen", icon: Cpu },
  { to: "/materials", label: "Inventar", icon: Package },
  { to: "/invoices", label: "Rechnungen", icon: Receipt },
  { to: "/visits", label: "Besuche", icon: ClipboardList },
  { to: "/usages", label: "Nutzungen", icon: History },
  { to: "/audit", label: "Audit-Log", icon: FileText },
  // What runs where right now (ADR-0045 phase 3).
  { to: "/versions", label: "Versionen", icon: Server },
]

function AdminAuthenticatedLayout() {
  return (
    <AuthenticatedLayout
      navItems={navItems}
      gate={{ kind: "admin" }}
      wrapper={LookupProvider}
      // Built bundles only: the dev server (and the e2e screenshots taken
      // on it) says "dev" and shows nothing.
      footerNote={BUILD_VERSION === "dev" ? null : `Version ${BUILD_VERSION}`}
    />
  )
}
