// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import {
  AuthenticatedLayout,
  type AuthenticatedLayoutNavItem,
} from "@modules/components/authenticated-layout"
import { LookupProvider } from "@modules/lib/lookup"
import {
  Cpu,
  ClipboardList,
  FileText,
  Key,
  List,
  Monitor,
  Package,
  Receipt,
  Shield,
} from "lucide-react"

export const Route = createFileRoute("/_authenticated")({
  component: AdminAuthenticatedLayout,
})

const navItems: AuthenticatedLayoutNavItem[] = [
  { to: "/users", label: "Benutzer", icon: Shield },
  { to: "/machines", label: "Maschinen", icon: Cpu },
  { to: "/permissions", label: "Berechtigungen", icon: Key },
  { to: "/terminals", label: "Terminals", icon: Monitor },
  { to: "/sessions", label: "Sitzungen", icon: ClipboardList },
  { to: "/checkouts", label: "Checkouts", icon: Receipt },
  { to: "/materials", label: "Materialien", icon: Package },
  { to: "/price-lists", label: "Preislisten", icon: List },
  { to: "/audit", label: "Audit Log", icon: FileText },
]

function AdminAuthenticatedLayout() {
  return (
    <AuthenticatedLayout
      navItems={navItems}
      gate={{ kind: "admin" }}
      wrapper={LookupProvider}
    />
  )
}
