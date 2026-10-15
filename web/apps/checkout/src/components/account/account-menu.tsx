// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The wizard's header menu for a signed-in visitor — the shared `AppMenu`
 * (#729) with the member-area destinations. Before the account menu the
 * identity in the wizard header was a bare text link that read as a status
 * label — nobody clicked it, so nobody found the membership page.
 *
 * Kiosk `actsAs` sessions (ADR-0041) route every destination through the
 * step-up dialog; "Abmelden" is the wizard's `startOver` for both session
 * kinds (the same wipe the anon "Von vorne beginnen" performs).
 */

import { useNavigate } from "@tanstack/react-router"
import { BadgeCheck, History, User } from "lucide-react"
import { AppMenu, type AppMenuEntry } from "@modules/components/app-header/app-menu"
import { useKioskElevation } from "@/components/checkout/kiosk-elevation-dialog"
import { useWizardContext } from "@/components/checkout/wizard-context"

type AccountRoute = "/account/profile" | "/account/membership" | "/account/usage"

export interface AccountMenuProps {
  /** Display name shown in the trigger and the menu header. */
  name: string
  /** Shown under the name in the menu header; omitted when unknown. */
  email?: string | null
  /** Stable seed for the avatar colour (user id). */
  userId?: string
  /** True for a kiosk `actsAs` session: destinations step up first. */
  kioskSession?: boolean
}

export function AccountMenu({
  name,
  email,
  userId,
  kioskSession = false,
}: AccountMenuProps) {
  const navigate = useNavigate()
  const { ensureElevated } = useKioskElevation()
  const { startOver } = useWizardContext()

  const entry = (
    to: AccountRoute,
    icon: AppMenuEntry["icon"],
    label: string,
  ): AppMenuEntry =>
    kioskSession
      ? { label, icon, onSelect: () => ensureElevated(() => navigate({ to })) }
      : { label, icon, to }

  const profile = entry("/account/profile", User, "Profil")
  const usage = entry("/account/usage", History, "Nutzungsverlauf")
  const membership = entry("/account/membership", BadgeCheck, "Mitgliedschaft")

  return (
    <AppMenu
      identity={{ name, email, userId }}
      // Desktop dropdown: the profile leads because it names the person in
      // the header. The mobile sheet follows the member-area sidebar order.
      menuItems={[profile, usage, membership]}
      navItems={[usage, membership, profile]}
      onSignOut={() => void startOver()}
    />
  )
}
