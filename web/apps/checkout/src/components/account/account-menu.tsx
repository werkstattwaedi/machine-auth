// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Header account menu (design handoff "Kontobereich sichtbar machen",
 * option 1a): name + avatar + chevron as a recognisable menu trigger that
 * opens a dropdown naming the member-area destinations. Before this the
 * identity in the wizard header was a bare text link that read as a status
 * label — nobody clicked it, so nobody found the membership page.
 *
 * Kiosk `actsAs` sessions (ADR-0041) route every destination through the
 * step-up dialog; "Abmelden" is the wizard's `startOver` for both session
 * kinds (the same wipe the person card's "Abmelden" performs).
 */

import { Link, useNavigate } from "@tanstack/react-router"
import { BadgeCheck, ChevronDown, History, LogOut, User } from "lucide-react"
import { Avatar } from "@modules/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modules/components/ui/dropdown-menu"
import { useKioskElevation } from "@/components/checkout/kiosk-elevation-dialog"
import { useWizardContext } from "@/components/checkout/wizard-context"

type AccountRoute = "/account/profile" | "/account/membership" | "/account/usage"

const ITEM_CLASS =
  "cursor-pointer gap-2.5 rounded-[6px] px-3 py-[9px] text-sm text-foreground focus:bg-cog-teal-light focus:text-foreground [&_svg:not([class*='text-'])]:text-foreground"

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

  const item = (to: AccountRoute, Icon: typeof User, label: string) =>
    kioskSession ? (
      <DropdownMenuItem
        className={ITEM_CLASS}
        onSelect={() => ensureElevated(() => navigate({ to }))}
      >
        <Icon aria-hidden />
        {label}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem asChild className={ITEM_CLASS}>
        <Link to={to}>
          <Icon aria-hidden />
          {label}
        </Link>
      </DropdownMenuItem>
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Konto-Menü"
          data-testid="wizard-header-account"
          className="inline-flex h-10 min-w-0 items-center gap-2.5 rounded-full border border-border bg-background pl-1.5 pr-2.5 text-sm font-medium text-foreground shadow-xs outline-none transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-cog-teal hover:bg-cog-teal-light focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-cog-teal data-[state=open]:bg-cog-teal-light sm:h-11 sm:pl-3.5"
        >
          <span className="hidden truncate sm:inline">{name}</span>
          <Avatar name={name} seed={userId} size="sm" className="size-[30px]" />
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[264px] rounded-[10px] border-border bg-card p-1.5 shadow-lg"
      >
        <div className="mb-1.5 border-b border-border px-3 pb-2 pt-2.5">
          <div className="truncate font-heading text-sm font-bold">{name}</div>
          {email && (
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          )}
        </div>
        {/* Same labels and icons as the member-area sidebar (order differs:
            the profile leads here because it names the person in the header). */}
        {item("/account/profile", User, "Profil")}
        {item("/account/usage", History, "Nutzungsverlauf")}
        {item("/account/membership", BadgeCheck, "Mitgliedschaft")}
        <DropdownMenuSeparator className="mx-2 my-1.5" />
        <DropdownMenuItem
          className={ITEM_CLASS}
          onSelect={() => void startOver()}
        >
          <LogOut aria-hidden />
          Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
