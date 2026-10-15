// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The single menu top right in every shell of both apps (issue #729, design
// "C2"). It replaced three separate things: the checkout account dropdown,
// the mobile hamburger sheet on the left and the sidebar footer (avatar row,
// sign-out, version · "Problem melden"). On mobile the way into the account
// and the way around the app were two hidden menus with nearly the same
// contents; now there is one.
//
//   desktop (≥ md): dropdown — `menuItems`, "Problem melden", ─, trailing
//   mobile  (< md): sheet from the right — `headerAction`, `navItems`, ─,
//                   "Problem melden", trailing (it replaces the sidebar, so
//                   it follows the sidebar's order)
//
// Without an `identity` the trigger is the anonymous "Menü" pill, and when
// there is nothing to offer at all it renders nothing (no empty menu).

import { useEffect, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import {
  ChevronDown,
  LogOut,
  Menu,
  MessageSquareWarning,
  type LucideIcon,
} from "lucide-react"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { Avatar } from "@modules/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modules/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@modules/components/ui/sheet"
import { isFeedbackAvailable, openFeedback } from "@modules/lib/feedback-widget"
import { cn } from "@modules/lib/utils"

export interface AppMenuEntry {
  label: string
  icon: LucideIcon
  /** Route the entry links to. */
  to?: string
  search?: Record<string, unknown>
  /** Action instead of a link (e.g. the kiosk step-up before navigating). */
  onSelect?: () => void
  /** Sidebar-style solid CTA (see `AuthenticatedLayoutNavItem.primary`). */
  primary?: boolean
}

export interface AppMenuIdentity {
  /** Display name shown in the trigger and the menu header. */
  name: string
  /** Shown under the name in the menu header; omitted when unknown. */
  email?: string | null
  /** Stable seed for the avatar colour (user id). */
  userId?: string
}

export interface AppMenuProps {
  /** Signed-in principal; absent renders the anonymous "Menü" trigger. */
  identity?: AppMenuIdentity
  /** Desktop dropdown entries, listed before "Problem melden". */
  menuItems?: AppMenuEntry[]
  /** Mobile sheet navigation (what the sidebar shows on desktop). */
  navItems?: AppMenuEntry[]
  /** Rendered above `navItems` in the sheet (the checkout's visit CTA). */
  headerAction?: ReactNode
  /** Entries after the separator, before "Abmelden". */
  trailingItems?: AppMenuEntry[]
  /** Adds "Abmelden" as the last entry. */
  onSignOut?: () => void
}

// A left accent border is reserved for the active item; inactive items
// carry a transparent border of the same width so the row geometry stays
// identical and the label doesn't shift on activation.
const NAV_LINK =
  "flex items-center gap-2.5 border-l-2 border-transparent px-3 py-2 rounded-[3px] text-sm transition-colors"
// Active = "you are here": a SUBTLE pale tint, dark-teal text and a left
// accent border — deliberately NOT the solid teal fill, which is reserved
// for the primary visit CTA. Solid-on-solid made the current page and the
// call-to-action indistinguishable (issue #363).
const NAV_LINK_ACTIVE =
  "[&.active]:bg-cog-teal-light [&.active]:text-cog-teal-dark [&.active]:font-semibold [&.active]:border-cog-teal"
// Hover only tints inactive rows; the active row keeps its pale tint so a
// hover doesn't wash out the "current page" signal.
const NAV_LINK_HOVER = "hover:bg-cog-teal-light/60 [&.active]:hover:bg-cog-teal-light"
// Primary item = solid-teal CTA. Overrides the subtle active style so the
// call-to-action always reads as a button, never as the current page.
const NAV_LINK_PRIMARY =
  "bg-cog-teal text-white font-bold hover:bg-cog-teal-dark [&.active]:bg-cog-teal [&.active]:text-white [&.active]:hover:bg-cog-teal-dark"

/** Row style of the sidebar nav and the mobile sheet. */
export function navLinkClass(primary?: boolean): string {
  return primary
    ? `${NAV_LINK} ${NAV_LINK_PRIMARY}`
    : `${NAV_LINK} ${NAV_LINK_ACTIVE} ${NAV_LINK_HOVER}`
}

const ITEM_CLASS =
  "cursor-pointer gap-2.5 rounded-[6px] px-3 py-[9px] text-sm text-foreground focus:bg-cog-teal-light focus:text-foreground [&_svg:not([class*='text-'])]:text-foreground"

const TRIGGER_CLASS =
  "inline-flex h-10 min-w-0 shrink-0 items-center rounded-full border border-border bg-background text-sm font-medium text-foreground shadow-xs outline-none transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-cog-teal hover:bg-cog-teal-light focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-cog-teal data-[state=open]:bg-cog-teal-light sm:h-11"

export function AppMenu({
  identity,
  menuItems = [],
  navItems = [],
  headerAction,
  trailingItems = [],
  onSignOut,
}: AppMenuProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  // One state drives whichever of dropdown / sheet is mounted. A resize
  // across the breakpoint swaps them, so close it rather than reopening the
  // other one under the user's hands.
  const [openedAsMobile, setOpenedAsMobile] = useState(isMobile)
  if (openedAsMobile !== isMobile) {
    setOpenedAsMobile(isMobile)
    if (open) setOpen(false)
  }

  // The MarkerIO loader mounts after the route outlet, so its stub is
  // installed only after this menu's first commit. Re-check once that commit
  // has settled — otherwise the anonymous trigger, which may exist only for
  // "Problem melden", would stay missing until something else re-renders.
  const [feedbackSeen, setFeedbackSeen] = useState(isFeedbackAvailable)
  useEffect(() => {
    if (feedbackSeen) return
    const t = window.setTimeout(() => {
      if (isFeedbackAvailable()) setFeedbackSeen(true)
    }, 0)
    return () => window.clearTimeout(t)
  }, [feedbackSeen])

  // Marker.io capture (issue #669). Opens directly — on a kiosk too, without
  // the step-up: reporting a problem touches no account data.
  const feedback: AppMenuEntry | null = feedbackSeen || isFeedbackAvailable()
    ? { label: "Problem melden", icon: MessageSquareWarning, onSelect: openFeedback }
    : null
  const trailing: AppMenuEntry[] = [
    ...trailingItems,
    ...(onSignOut
      ? [{ label: "Abmelden", icon: LogOut, onSelect: onSignOut }]
      : []),
  ]

  const hasNav = navItems.length > 0 || headerAction != null
  if (
    !identity &&
    !feedback &&
    menuItems.length === 0 &&
    trailing.length === 0 &&
    !hasNav
  ) {
    return null
  }

  const trigger = identity ? (
    isMobile ? (
      <button
        type="button"
        aria-label="Menü"
        data-testid="app-menu-trigger"
        className={cn(TRIGGER_CLASS, "gap-2 pl-1.5 pr-2.5")}
      >
        <Avatar name={identity.name} seed={identity.userId} size="sm" className="size-[30px]" />
        <Menu className="size-5 shrink-0" aria-hidden />
      </button>
    ) : (
      <button
        type="button"
        aria-label="Konto-Menü"
        data-testid="app-menu-trigger"
        className={cn(TRIGGER_CLASS, "gap-2.5 pl-3.5 pr-2.5")}
      >
        <span className="max-w-[240px] truncate">{identity.name}</span>
        <Avatar name={identity.name} seed={identity.userId} size="sm" className="size-[30px]" />
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={2}
          aria-hidden
        />
      </button>
    )
  ) : (
    <button
      type="button"
      aria-label="Menü"
      data-testid="app-menu-trigger"
      className={cn(
        TRIGGER_CLASS,
        isMobile ? "w-10 justify-center sm:w-11" : "gap-2.5 pl-4 pr-3 font-bold",
      )}
    >
      {!isMobile && <span>Menü</span>}
      <Menu className="size-5 shrink-0" aria-hidden />
    </button>
  )

  if (isMobile) {
    const close = () => setOpen(false)
    const sheetRow = (entry: AppMenuEntry, nav: boolean) => {
      const Icon = entry.icon
      const className = nav
        ? navLinkClass(entry.primary)
        : `${NAV_LINK} ${NAV_LINK_HOVER}`
      if (entry.to && !entry.onSelect) {
        return (
          <Link
            key={entry.label}
            to={entry.to}
            search={entry.search}
            className={className}
            onClick={close}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {entry.label}
          </Link>
        )
      }
      return (
        <button
          key={entry.label}
          type="button"
          className={cn(className, "w-full text-left")}
          onClick={() => {
            close()
            entry.onSelect?.()
          }}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {entry.label}
        </button>
      )
    }
    // With navigation the sheet replaces the sidebar: nav first, then the
    // utility entries. Without (anonymous wizard) it mirrors the dropdown.
    const sections: ReactNode[][] = hasNav
      ? [
          [
            headerAction != null ? (
              <div key="header-action" className="mb-2" onClick={close}>
                {headerAction}
              </div>
            ) : null,
            ...navItems.map((e) => sheetRow(e, true)),
          ],
          [feedback, ...trailing].flatMap((e) => (e ? [sheetRow(e, false)] : [])),
        ]
      : [
          feedback ? [sheetRow(feedback, false)] : [],
          trailing.map((e) => sheetRow(e, false)),
        ]
    const filled = sections.filter((s) => s.some(Boolean))

    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="right"
          className="w-[290px] gap-0 p-0 sm:max-w-[290px]"
          aria-describedby={undefined}
          data-testid="app-menu-sheet"
        >
          <div className="flex items-center gap-3 border-b border-border py-4 pl-4 pr-12">
            {identity ? (
              <>
                <Avatar name={identity.name} seed={identity.userId} />
                <div className="min-w-0">
                  <SheetTitle className="truncate font-heading text-base font-bold">
                    {identity.name}
                  </SheetTitle>
                  {identity.email && (
                    <div className="truncate text-xs text-muted-foreground">
                      {identity.email}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <SheetTitle className="font-heading text-base font-bold">Menü</SheetTitle>
            )}
          </div>
          <nav className="flex flex-col gap-0.5 overflow-y-auto px-2 py-3">
            {filled.map((section, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                {i > 0 && <div className="mx-1 my-2 h-px bg-border" role="separator" />}
                {section}
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    )
  }

  const dropdownItem = (entry: AppMenuEntry) => {
    const Icon = entry.icon
    if (entry.to && !entry.onSelect) {
      return (
        <DropdownMenuItem key={entry.label} asChild className={ITEM_CLASS}>
          <Link to={entry.to} search={entry.search}>
            <Icon aria-hidden />
            {entry.label}
          </Link>
        </DropdownMenuItem>
      )
    }
    return (
      <DropdownMenuItem
        key={entry.label}
        className={ITEM_CLASS}
        onSelect={() => entry.onSelect?.()}
      >
        <Icon aria-hidden />
        {entry.label}
      </DropdownMenuItem>
    )
  }
  const lead = [...menuItems, ...(feedback ? [feedback] : [])]

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={cn(
          "rounded-[10px] border-border bg-card p-1.5 shadow-lg",
          identity ? "w-[264px]" : "min-w-[228px]",
        )}
      >
        {identity && (
          <div className="mb-1.5 border-b border-border px-3 pb-2 pt-2.5">
            <div className="truncate font-heading text-sm font-bold">{identity.name}</div>
            {identity.email && (
              <div className="truncate text-xs text-muted-foreground">{identity.email}</div>
            )}
          </div>
        )}
        {lead.map(dropdownItem)}
        {lead.length > 0 && trailing.length > 0 && (
          <DropdownMenuSeparator className="mx-2 my-1.5" />
        )}
        {trailing.map(dropdownItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
