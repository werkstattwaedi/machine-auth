// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { where } from "firebase/firestore"
import {
  AlertTriangle,
  BadgeCheck,
  History,
  Plus,
  ShoppingCart,
  User,
} from "lucide-react"
import {
  AuthenticatedLayout,
  type AuthenticatedLayoutNavItem,
} from "@modules/components/authenticated-layout"
import { useAuth } from "@modules/lib/auth"
import { useCollection } from "@modules/lib/firestore"
import {
  checkoutsCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { isCheckoutStale } from "@modules/lib/session-day"
import { useBridge } from "@modules/lib/use-bridge"
import { cn } from "@modules/lib/utils"
import { runStartOver } from "@/components/checkout/start-over"

export const Route = createFileRoute("/_authenticated")({
  component: CheckoutAuthenticatedLayout,
})

const navItems: AuthenticatedLayoutNavItem[] = [
  { to: "/account/usage", label: "Nutzungsverlauf", icon: History },
  { to: "/account/membership", label: "Mitgliedschaft", icon: BadgeCheck },
  { to: "/account/profile", label: "Profil", icon: User },
]

function CheckoutAuthenticatedLayout() {
  const bridge = useBridge()
  const { signOut } = useAuth()
  return (
    <AuthenticatedLayout
      navItems={navItems}
      gate={{ kind: "member", completeProfilePath: "/account/complete-profile" }}
      headerAction={<VisitCta />}
      signOutRedirect="/checkin"
      // Inside the Electron kiosk (ADR-0041) the member area is reached by an
      // OTP-elevated session; leaving it must be the same strong wipe as the
      // chrome's "Neuer Checkout".
      kiosk={
        bridge.available
          ? {
              checkoutPath: "/checkin?kiosk",
              onSignOut: () =>
                void runStartOver({
                  signOut,
                  bridgeAvailable: true,
                  resetSession: bridge.resetSession,
                  reload: (target) => window.location.replace(target),
                  kiosk: true,
                }),
            }
          : undefined
      }
    />
  )
}

/**
 * State-aware sidebar CTA — sits above the account-nav items.
 *
 *   no open checkout                  → "Neuer Besuch starten" (teal)
 *   open checkout from today          → "Mein Besuch"          (teal)
 *   open checkout from previous day   → "Offener Besuch …"     (red/orange)
 *
 * All variants navigate to `/`; the root dispatcher routes to the right
 * wizard step.
 */
function VisitCta() {
  const db = useDb()
  const bridge = useBridge()
  const { userDoc } = useAuth()
  const ref = userDoc ? userRef(db, userDoc.id) : null
  const { data: openCheckouts } = useCollection(
    ref ? checkoutsCollection(db) : null,
    ...(ref
      ? [where("userId", "==", ref), where("status", "==", "open")]
      : []),
  )
  const openCheckout = openCheckouts[0] ?? null
  const created = (openCheckout?.created as { toDate(): Date } | undefined)
    ?.toDate()
  const stale = created ? isCheckoutStale(created) : false

  let label = "Neuer Besuch starten"
  let Icon: typeof Plus = Plus
  if (openCheckout && stale) {
    label = "Offener Besuch abschliessen"
    Icon = AlertTriangle
  } else if (openCheckout) {
    label = "Mein Besuch"
    Icon = ShoppingCart
  }

  return (
    <Link
      to="/"
      // Keep the kiosk flag so the dispatcher lands on /checkin?kiosk.
      search={bridge.available ? { kiosk: "" } : {}}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-[3px] px-3 py-2 text-sm font-bold transition-colors",
        stale
          ? "bg-[#cc2a24] text-white hover:bg-[#a82420]"
          : "bg-cog-teal text-white hover:bg-cog-teal-dark",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  )
}
