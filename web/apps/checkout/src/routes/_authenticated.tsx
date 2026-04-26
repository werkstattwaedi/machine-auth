// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import {
  AuthenticatedLayout,
  type AuthenticatedLayoutNavItem,
} from "@modules/components/authenticated-layout"
import { History, Home, User } from "lucide-react"

export const Route = createFileRoute("/_authenticated")({
  component: CheckoutAuthenticatedLayout,
})

const navItems: AuthenticatedLayoutNavItem[] = [
  { to: "/visit", label: "Aktueller Besuch", icon: Home },
  { to: "/profile", label: "Profil", icon: User },
  { to: "/usage", label: "Nutzungsverlauf", icon: History },
]

function CheckoutAuthenticatedLayout() {
  return (
    <AuthenticatedLayout
      navItems={navItems}
      gate={{ kind: "member", completeProfilePath: "/complete-profile" }}
    />
  )
}
