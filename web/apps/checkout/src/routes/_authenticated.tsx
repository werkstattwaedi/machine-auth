// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import {
  AuthenticatedLayout,
  type AuthenticatedLayoutNavItem,
} from "@modules/components/authenticated-layout"
import { BadgeCheck, History, User } from "lucide-react"

export const Route = createFileRoute("/_authenticated")({
  component: CheckoutAuthenticatedLayout,
})

const navItems: AuthenticatedLayoutNavItem[] = [
  { to: "/account/usage", label: "Nutzungsverlauf", icon: History },
  { to: "/account/membership", label: "Mitgliedschaft", icon: BadgeCheck },
  { to: "/account/profile", label: "Profil", icon: User },
]

function CheckoutAuthenticatedLayout() {
  return (
    <AuthenticatedLayout
      navItems={navItems}
      gate={{ kind: "member", completeProfilePath: "/account/complete-profile" }}
    />
  )
}
