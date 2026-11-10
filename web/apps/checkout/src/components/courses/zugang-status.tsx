// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * «Zugang» of a participant (#842, CRS-5): Konto, Badge and — on a course
 * that gives one (CRS-17) — the permission, as three icons, plus the next
 * step in bold. Done = green, the next open step = gold, not reachable yet
 * = grey dashed; the permission shows the choice (Vorläufig teal,
 * Ja/already held green, Nein red).
 */

import { CreditCard, KeyRound, User } from "lucide-react"
import type { CourseParticipant } from "@oww/shared"
import { cn } from "@modules/lib/utils"

type Tone = "done" | "next" | "todo" | "temp" | "no"

export interface ZugangState {
  konto: Tone
  badge: Tone
  permission: Tone | null
  /** The bold text beside the icons, or null. */
  next: string | null
  /** Spelled out for aria-label / tooltip. */
  label: string
}

export function zugangState(
  p: Pick<CourseParticipant, "link">,
  opts: { hasPermission: boolean; kiosk: boolean; closed: boolean; leaderUserId?: string }
): ZugangState {
  const link = p.link
  const own = !!link && link.userId === opts.leaderUserId
  const konto: Tone = link ? "done" : "next"
  let badge: Tone
  if (!link) badge = "todo"
  else if (link.hasBadge) badge = "done"
  else if (opts.hasPermission && link.choice === "no" && !link.alreadyHeld) badge = "todo"
  else if (own) badge = "todo"
  else badge = "next"
  let permission: Tone | null = null
  if (opts.hasPermission) {
    if (!link) permission = "todo"
    else if (link.alreadyHeld || link.choice === "yes") permission = "done"
    else if (link.choice === "temp") permission = "temp"
    else permission = "no"
  }
  let next: string | null = null
  if (!opts.closed) {
    if (konto === "next") next = "Konto verknüpfen"
    else if (badge === "next") next = opts.kiosk ? "Badge zuweisen" : "Badge am Kiosk zuweisen"
  }
  const parts = [
    link ? "Konto verknüpft" : "Kein Konto verknüpft",
    !link ? "Badge offen" : link.hasBadge ? "Badge vorhanden" : "Badge fehlt",
  ]
  if (opts.hasPermission) {
    parts.push(
      !link
        ? "Berechtigung offen"
        : link.alreadyHeld
          ? "Schon berechtigt"
          : link.choice === "yes"
            ? "Berechtigung: Ja"
            : link.choice === "temp"
              ? "Berechtigung: Vorläufig"
              : "Berechtigung: Nein"
    )
  }
  return { konto, badge, permission, next, label: parts.join(", ") }
}

const TONE: Record<Tone, string> = {
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  next: "bg-oww-gold text-oww-gold-text",
  todo: "border border-dashed border-border text-muted-foreground",
  temp: "bg-cog-teal/15 text-cog-teal-dark dark:text-cog-teal",
  no: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
}

function Dot({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5", TONE[tone])}>
      {children}
    </span>
  )
}

export function ZugangStatus({ state, className }: { state: ZugangState; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="flex items-center gap-1.5" role="img" aria-label={state.label} title={state.label}>
        <Dot tone={state.konto}>
          <User />
        </Dot>
        <Dot tone={state.badge}>
          <CreditCard />
        </Dot>
        {state.permission && (
          <Dot tone={state.permission}>
            <KeyRound />
          </Dot>
        )}
      </span>
      {state.next && <span className="text-sm font-semibold text-oww-gold-text sm:ml-1.5 sm:whitespace-nowrap">{state.next}</span>}
    </div>
  )
}
