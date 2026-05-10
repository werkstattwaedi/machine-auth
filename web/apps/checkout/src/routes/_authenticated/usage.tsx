// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth, type UserDoc } from "@modules/lib/auth"
import { useCollection } from "@modules/lib/firestore"
import { where, orderBy } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import {
  userRef,
  billsCollection,
  checkoutsCollection,
} from "@modules/lib/firestore-helpers"
import type { BillDoc, CheckoutDoc } from "@modules/lib/firestore-entities"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { formatDate, formatCHF, formatInvoiceNumber } from "@modules/lib/format"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { QueryError } from "@modules/components/query-error"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { cn } from "@modules/lib/utils"
import {
  History,
  FileText,
  Download,
  Loader2,
  Receipt,
} from "lucide-react"
import { useMemo, useState } from "react"

export const Route = createFileRoute("/_authenticated/usage")({
  component: UsagePage,
})

const paidViaLabel: Record<string, string> = {
  twint: "TWINT",
  ebanking: "E-Banking",
  cash: "Bar",
}

type FilterKey = "all" | "open" | "paid"
type TabKey = "invoices" | "sessions"

function UsagePage() {
  const { userDoc, userDocLoading } = useAuth()

  if (userDocLoading) return <PageLoading />
  if (!userDoc) {
    return (
      <EmptyState
        icon={History}
        title="Konto nicht gefunden"
        description="Dein Benutzerkonto konnte nicht geladen werden. Bitte melde dich erneut an."
      />
    )
  }

  return <UsageContent userDoc={userDoc} />
}

function UsageContent({ userDoc }: { userDoc: UserDoc }) {
  const db = useDb()
  const ref = userRef(db, userDoc.id)

  const {
    data: bills,
    loading: billsLoading,
    error: billsError,
  } = useCollection(
    billsCollection(db),
    where("userId", "==", ref),
    orderBy("created", "desc"),
  )

  const {
    data: closedCheckouts,
    loading: checkoutsLoading,
    error: checkoutsError,
  } = useCollection(
    checkoutsCollection(db),
    where("userId", "==", ref),
    where("status", "==", "closed"),
    orderBy("closedAt", "desc"),
  )

  const [tab, setTab] = useState<TabKey>("invoices")
  const [filter, setFilter] = useState<FilterKey>("all")

  const stats = useMemo(() => {
    const openBills = bills.filter((b) => !b.paidAt)
    const totalOpen = openBills.reduce((s, b) => s + b.amount, 0)
    const currentYear = new Date().getFullYear()
    const yearBills = bills.filter(
      (b) => toJsDate(b.created)?.getFullYear() === currentYear,
    )
    const totalYear = yearBills.reduce((s, b) => s + b.amount, 0)
    const lastSession = closedCheckouts[0]
    return {
      totalOpen,
      openCount: openBills.length,
      totalYear,
      yearCount: yearBills.length,
      currentYear,
      lastSession,
    }
  }, [bills, closedCheckouts])

  if (billsLoading || checkoutsLoading) return <PageLoading />
  if (billsError || checkoutsError) return <QueryError context="usage" />

  const filteredBills = bills.filter((b) => {
    if (filter === "open") return !b.paidAt
    if (filter === "paid") return !!b.paidAt
    return true
  })

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl leading-tight">
          Nutzungsverlauf
        </h1>
        <p className="text-sm text-muted-foreground">
          Deine Werkstatt-Besuche und Rechnungen.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Offen"
          value={formatCHF(stats.totalOpen)}
          foot={`${stats.openCount} ${stats.openCount === 1 ? "Rechnung" : "Rechnungen"}`}
        />
        <StatCard
          label={`${stats.currentYear} gesamt`}
          value={formatCHF(stats.totalYear)}
          foot={`${stats.yearCount} ${stats.yearCount === 1 ? "Rechnung" : "Rechnungen"}`}
        />
        <StatCard
          label="Letzter Besuch"
          value={
            stats.lastSession
              ? lastSessionTitle(stats.lastSession)
              : "—"
          }
          valueClassName="text-[20px]"
          foot={
            stats.lastSession
              ? formatDate(
                  stats.lastSession.closedAt ?? stats.lastSession.created,
                )
              : "Noch kein Besuch"
          }
        />
      </div>

      <div className="border-b border-border flex gap-1">
        <TabButton
          active={tab === "invoices"}
          onClick={() => setTab("invoices")}
          icon={<Receipt className="h-3.5 w-3.5" />}
        >
          Rechnungen
        </TabButton>
        <TabButton
          active={tab === "sessions"}
          onClick={() => setTab("sessions")}
          icon={<History className="h-3.5 w-3.5" />}
        >
          Werkstatt-Besuche
        </TabButton>
      </div>

      {tab === "invoices" && (
        <InvoicesPanel
          bills={filteredBills}
          allBills={bills}
          filter={filter}
          onFilterChange={setFilter}
        />
      )}

      {tab === "sessions" && (
        <SessionsPanel checkouts={closedCheckouts} />
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  foot,
  valueClassName,
}: {
  label: string
  value: string
  foot: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs px-5 py-4 flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-heading font-bold text-[26px] leading-tight tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{foot}</span>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2.5 -mb-px text-sm border-b-2 transition-colors",
        active
          ? "text-cog-teal-dark border-cog-teal font-semibold"
          : "text-muted-foreground border-transparent hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function InvoicesPanel({
  bills,
  allBills,
  filter,
  onFilterChange,
}: {
  bills: (BillDoc & { id: string })[]
  allBills: (BillDoc & { id: string })[]
  filter: FilterKey
  onFilterChange: (f: FilterKey) => void
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border flex-wrap">
        <h2 className="font-heading font-bold text-lg">Rechnungen</h2>
        <div className="inline-flex bg-muted/40 rounded-md p-[3px]">
          <FilterPill
            active={filter === "all"}
            onClick={() => onFilterChange("all")}
          >
            Alle
          </FilterPill>
          <FilterPill
            active={filter === "open"}
            onClick={() => onFilterChange("open")}
          >
            Offen
          </FilterPill>
          <FilterPill
            active={filter === "paid"}
            onClick={() => onFilterChange("paid")}
          >
            Bezahlt
          </FilterPill>
        </div>
      </div>
      {allBills.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Keine Rechnungen"
          description="Hier erscheinen deine Rechnungen."
        />
      ) : bills.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted-foreground">
          Keine Rechnungen in dieser Auswahl.
        </div>
      ) : (
        <>
          {/* Mobile: stacked rows so the download icon never gets clipped
              by the card's `overflow-hidden` (issue #215). */}
          <ul className="sm:hidden flex flex-col">
            {bills.map((bill) => (
              <li
                key={bill.id}
                className="flex items-center gap-3 px-4 py-3 border-t border-border first:border-t-0 text-sm"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-semibold">
                    {formatInvoiceNumber(bill.referenceNumber)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(bill.created)}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums whitespace-nowrap">
                    {formatCHF(bill.amount)}
                  </span>
                  {bill.paidAt ? (
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent">
                      Bezahlt
                      {bill.paidVia
                        ? ` (${paidViaLabel[bill.paidVia] ?? bill.paidVia})`
                        : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Offen</Badge>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {bill.storagePath && <DownloadButton billId={bill.id} />}
                </div>
              </li>
            ))}
          </ul>
          {/* Desktop: table layout preserved at sm+. */}
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Nr.
                </th>
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Datum
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Betrag
                </th>
                <th className="px-6 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Status
                </th>
                <th className="px-6 py-3 w-12" aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr
                  key={bill.id}
                  className="border-t border-border hover:bg-muted/30"
                >
                  <td className="px-6 py-3 font-semibold">
                    {formatInvoiceNumber(bill.referenceNumber)}
                  </td>
                  <td className="px-6 py-3 tabular-nums">
                    {formatDate(bill.created)}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {formatCHF(bill.amount)}
                  </td>
                  <td className="px-6 py-3">
                    {bill.paidAt ? (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-transparent">
                        Bezahlt
                        {bill.paidVia
                          ? ` (${paidViaLabel[bill.paidVia] ?? bill.paidVia})`
                          : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Offen</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {bill.storagePath && <DownloadButton billId={bill.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function SessionsPanel({
  checkouts,
}: {
  checkouts: (CheckoutDoc & { id: string })[]
}) {
  if (checkouts.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card shadow-xs">
        <EmptyState
          icon={History}
          title="Noch keine Besuche"
          description="Sobald du in der Werkstatt eincheckst, erscheint dein Besuch hier."
        />
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
        <h2 className="font-heading font-bold text-lg">Werkstatt-Besuche</h2>
        <span className="text-sm text-muted-foreground">
          {checkouts.length} {checkouts.length === 1 ? "Besuch" : "Besuche"}
        </span>
      </div>
      <ul className="flex flex-col">
        {checkouts.map((co) => {
          const closed = toJsDate(co.closedAt)
          const created = toJsDate(co.created)
          const date = closed ?? created ?? new Date()
          const durationMs =
            closed && created ? closed.getTime() - created.getTime() : 0
          const minutes = Math.max(0, Math.round(durationMs / 60000))
          const workshops = co.workshopsVisited ?? []
          const total = co.summary?.totalPrice ?? 0
          return (
            <li
              key={co.id}
              className="grid grid-cols-[140px_minmax(0,1fr)_auto_auto] gap-4 items-center px-6 py-3.5 border-t border-border first:border-t-0 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-semibold tabular-nums">
                  {formatDate(co.closedAt ?? co.created)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatTime(date)}
                </span>
              </div>
              <div className="flex items-center gap-2.5 min-w-0">
                {workshops.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <>
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: workshopColor(workshops[0]) }}
                    />
                    <span className="font-semibold truncate">
                      {workshopLabel(workshops)}
                    </span>
                  </>
                )}
              </div>
              <div className="text-muted-foreground tabular-nums whitespace-nowrap">
                {formatDuration(minutes)}
              </div>
              <div className="font-semibold tabular-nums text-right whitespace-nowrap min-w-[80px]">
                {formatCHF(total)}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Tolerant Timestamp-or-Date converter — fakes used in tests store plain
 *  Date instances, while live Firestore returns Timestamp. */
function toJsDate(
  value: Date | { toDate(): Date } | null | undefined,
): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  return value.toDate()
}

const WORKSHOP_PALETTE: Record<string, string> = {
  laser: "#3aa8b1",
  holz: "#cf6e3a",
  fdm: "#7a5cb5",
  sla: "#7a5cb5",
  metall: "#8a8378",
  textil: "#d4a017",
  keramik: "#a86f5a",
}

function workshopColor(id: string): string {
  return WORKSHOP_PALETTE[id] ?? "var(--color-cog-teal-dark)"
}

function workshopLabel(workshops: string[]): string {
  if (workshops.length === 1) return capitalize(workshops[0])
  return `${capitalize(workshops[0])} +${workshops.length - 1}`
}

function capitalize(s: string): string {
  if (!s) return s
  return s[0].toUpperCase() + s.slice(1)
}

function lastSessionTitle(co: CheckoutDoc & { id: string }): string {
  const w = co.workshopsVisited ?? []
  if (w.length === 0) return "Besuch"
  return workshopLabel(w)
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function DownloadButton({ billId }: { billId: string }) {
  const functions = useFunctions()
  // ADR-0025: hook owns the toast + telemetry. Caller must not add a
  // sibling try/catch with `toast.error`.
  const download = useAsyncMutation<void>({
    context: "usage.downloadInvoice",
    errorMessage: "PDF konnte nicht geladen werden.",
  })

  const handleDownload = () => {
    // useAsyncMutation re-throws on failure (ADR-0025). The hook already
    // toasted + telemetered, so we swallow at the click boundary to keep
    // the unhandled-rejection counter clean — there's no UI state to
    // advance after a failed download.
    void download
      .mutate(async () => {
        const getUrl = httpsCallable<{ billId: string }, { url: string }>(
          functions,
          "getInvoiceDownloadUrl",
        )
        const result = await getUrl({ billId })
        // Use a synthetic anchor click instead of window.open — after the
        // preceding await the user-gesture is gone and Chrome blocks popups.
        // The signed URL is served with Content-Disposition: attachment, so
        // the current tab never navigates.
        const a = document.createElement("a")
        a.href = result.data.url
        a.rel = "noopener"
        a.target = "_self"
        document.body.appendChild(a)
        a.click()
        a.remove()
      })
      .catch(() => {
        // see comment above
      })
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleDownload}
      disabled={download.loading}
      aria-label="PDF herunterladen"
    >
      {download.loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
    </Button>
  )
}
