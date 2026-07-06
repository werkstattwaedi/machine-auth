// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person · Übersicht — read-only. Answers "has a membership? open bills?
// last visit?" at a glance. Every card is a fact plus ONE link — either
// into a person tab or OUT into a shared ledger with the person filter
// pre-applied. Zero action buttons at this level.

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { where } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  billsCollection,
  checkoutsCollection,
  tokensCollection,
  usageMachineCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import type {
  MembershipDoc,
  UserDoc,
} from "@modules/lib/firestore-entities"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { billTotals } from "@/lib/bill-status"
import { formatCHF, formatDate, formatDateTime } from "@modules/lib/format"
import { formatDuration } from "@/lib/duration"
import { Clock, MoveRight } from "lucide-react"

export function PersonOverviewTab({
  userId,
  user,
  membership,
}: {
  userId: string
  user: UserDoc
  membership: (MembershipDoc & { id: string }) | null
}) {
  const db = useDb()
  const { machines } = useLookup()
  const personRef = userRef(db, userId)
  const { data: bills } = useCollection(
    billsCollection(db),
    where("userId", "==", personRef),
  )
  const { data: visits } = useCollection(
    checkoutsCollection(db),
    where("userId", "==", personRef),
  )
  const { data: usages } = useCollection(
    usageMachineCollection(db),
    where("userId", "==", personRef),
  )
  const { data: tokens } = useCollection(
    tokensCollection(db),
    where("userId", "==", personRef),
  )

  const totals = billTotals(bills, Date.now())
  const openVisit = visits.find((v) => v.status === "open")
  const lastVisit = [...visits]
    .filter((v) => v.status === "closed")
    .sort((a, b) => (b.created?.toMillis() ?? 0) - (a.created?.toMillis() ?? 0))[0]
  const lastUsage = [...usages].sort(
    (a, b) => (b.startTime?.toMillis() ?? 0) - (a.startTime?.toMillis() ?? 0),
  )[0]
  const activeTokens = tokens.filter((t) => !t.deactivated)

  return (
    <div className="space-y-4 pt-2">
      {openVisit && (
        <div className="flex items-center gap-3 rounded-xl border border-oww-gold-border border-l-4 border-l-oww-gold-dark bg-oww-gold-light px-4 py-3">
          <Clock className="h-5 w-5 shrink-0 text-oww-gold-text" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-oww-gold-text">
              Aktiver Besuch läuft
            </div>
            <div className="text-oww-gold-text-muted">
              seit {formatDateTime(openVisit.created)}
              {openVisit.workshopsVisited?.length
                ? ` · ${openVisit.workshopsVisited.join(", ")}`
                : ""}
            </div>
          </div>
          <Link
            to="/visits/$checkoutId"
            params={{ checkoutId: openVisit.id }}
            className="inline-flex items-center gap-1 text-sm font-medium text-oww-gold-text hover:underline"
          >
            Besuch öffnen
            <MoveRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <OverviewCard
          label="Mitgliedschaft"
          value={
            membership?.status === "active"
              ? `${membership.type === "family" ? "Familie" : "Einzel"} · aktiv`
              : membership
                ? membership.status === "expired"
                  ? "abgelaufen"
                  : "gekündigt"
                : "keine"
          }
          hint={
            membership ? `gültig bis ${formatDate(membership.validUntil)}` : undefined
          }
          link={
            <TabLink userId={userId} tab="membership">
              Tab öffnen
            </TabLink>
          }
        />
        <OverviewCard
          label="Offene Rechnungen"
          value={formatCHF(totals.openAmount)}
          tone={totals.openAmount > 0 ? "text-destructive" : undefined}
          accent={totals.openAmount > 0 ? "border-l-4 border-l-destructive" : undefined}
          hint={`${totals.openCount} offen · ${formatCHF(totals.overdueAmount)} überfällig`}
          link={
            <OutLink to="/invoices" userId={userId}>
              in Rechnungen
            </OutLink>
          }
        />
        <OverviewCard
          label="Letzter Besuch"
          value={lastVisit ? formatDate(lastVisit.created) : "–"}
          hint={lastVisit?.workshopsVisited?.join(", ") || undefined}
          link={
            <OutLink to="/visits" userId={userId}>
              in Besuche
            </OutLink>
          }
        />
        <OverviewCard
          label="Letzte Nutzung"
          value={lastUsage ? formatDate(lastUsage.startTime) : "–"}
          hint={
            lastUsage
              ? `${resolveRef(machines, lastUsage.machine)} · ${formatDuration(lastUsage.startTime, lastUsage.endTime)}`
              : undefined
          }
          link={
            <OutLink to="/usages" userId={userId}>
              in Nutzungen
            </OutLink>
          }
        />
        <OverviewCard
          label="Badges / NFC"
          value={`${activeTokens.length} aktiv`}
          link={
            <TabLink userId={userId} tab="badges">
              Tab öffnen
            </TabLink>
          }
        />
        <OverviewCard
          label="Berechtigungen"
          value={`${user.permissions?.length ?? 0} erteilt`}
          link={
            <TabLink userId={userId} tab="permissions">
              Tab öffnen
            </TabLink>
          }
        />
      </div>
    </div>
  )
}

function OverviewCard({
  label,
  value,
  hint,
  tone,
  accent,
  link,
}: {
  label: string
  value: string
  hint?: string
  tone?: string
  accent?: string
  link: ReactNode
}) {
  return (
    <div
      className={`flex min-h-24 flex-col gap-1 rounded-xl border bg-card p-4 shadow-sm ${accent ?? ""}`}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-heading text-lg font-bold ${tone ?? ""}`}>
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <span className="mt-auto self-end text-sm">{link}</span>
    </div>
  )
}

function TabLink({
  userId,
  tab,
  children,
}: {
  userId: string
  tab: "membership" | "badges" | "permissions"
  children: ReactNode
}) {
  return (
    <Link
      to="/users/$userId"
      params={{ userId }}
      search={{ tab }}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {children}
      <MoveRight className="h-3.5 w-3.5" />
    </Link>
  )
}

function OutLink({
  to,
  userId,
  children,
}: {
  to: "/invoices" | "/visits" | "/usages"
  userId: string
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      search={{ user: userId }}
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      {children}
      <MoveRight className="h-3.5 w-3.5" />
    </Link>
  )
}
