// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Rechnungen — the finance workspace. Status filters + summary strip,
// bulk "als bezahlt markieren", statement import top-right. Person
// deep-links from the person page land here with a removable chip.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { where, orderBy, limit } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import { billsCollection, userRef } from "@modules/lib/firestore-helpers"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { ActiveFilterChip } from "@/components/admin/active-filter-chip"
import { FilterPills } from "@/components/admin/filter-pills"
import { BulkBar } from "@/components/admin/bulk-bar"
import { StatCards } from "@/components/admin/stat-cards"
import { MarkPaidDialog } from "@/components/admin/mark-paid-dialog"
import { BillStatusBadge } from "@/components/admin/bill-status-badge"
import { billStatus, billTotals } from "@/lib/bill-status"
import {
  formatBillReference,
  formatCHF,
  formatDate,
} from "@modules/lib/format"
import { Button } from "@modules/components/ui/button"
import { Card } from "@modules/components/ui/card"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Input } from "@modules/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { EmptyState } from "@modules/components/empty-state"
import { CheckCheck, MoveRight, Receipt, Search, Upload } from "lucide-react"

type StatusFilter = "all" | "open" | "overdue" | "paid" | "beleg"

interface InvoicesSearch {
  user?: string
  status?: Exclude<StatusFilter, "all">
}

export const Route = createFileRoute("/_authenticated/invoices/")({
  validateSearch: (search: Record<string, unknown>): InvoicesSearch => ({
    user: typeof search.user === "string" ? search.user : undefined,
    status:
      search.status === "open" ||
      search.status === "overdue" ||
      search.status === "paid" ||
      search.status === "beleg"
        ? search.status
        : undefined,
  }),
  component: InvoicesPage,
})

function InvoicesPage() {
  const { user, status } = Route.useSearch()
  const navigate = useNavigate()
  const { users } = useLookup()
  const statusFilter: StatusFilter = status ?? "all"

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rechnungen"
        action={
          <Button asChild>
            <Link to="/invoices/import">
              <Upload className="mr-2 h-4 w-4" />
              Kontoauszug importieren
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {user && (
          <ActiveFilterChip
            label="Person"
            value={users.get(user) ?? user}
            onRemove={() =>
              navigate({ to: "/invoices", search: { user: undefined, status } })
            }
          />
        )}
        <FilterPills<StatusFilter>
          options={[
            { value: "all", label: "Alle" },
            { value: "open", label: "Offen" },
            { value: "overdue", label: "Überfällig" },
            { value: "paid", label: "Bezahlt" },
            { value: "beleg", label: "Belege" },
          ]}
          value={statusFilter}
          onChange={(v) =>
            navigate({
              to: "/invoices",
              search: { user, status: v === "all" ? undefined : v },
            })
          }
        />
      </div>
      <InvoicesContent key={user ?? ""} userId={user} statusFilter={statusFilter} />
    </div>
  )
}

function InvoicesContent({
  userId,
  statusFilter,
}: {
  userId?: string
  statusFilter: StatusFilter
}) {
  const db = useDb()
  const { users } = useLookup()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [markPaidOpen, setMarkPaidOpen] = useState(false)
  const [search, setSearch] = useState("")

  const constraints = userId
    ? [where("userId", "==", userRef(db, userId)), limit(500)]
    : [orderBy("created", "desc"), limit(300)]
  const { data, loading } = useCollection(billsCollection(db), ...constraints)

  const nowMs = Date.now()
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return data
      .map((bill) => ({
        ...bill,
        derivedStatus: billStatus(bill, nowMs),
        personName: bill.userId ? resolveRef(users, bill.userId) : "–",
        reference: formatBillReference(bill.referenceNumber, bill.kind),
      }))
      .filter((b) => statusFilter === "all" || b.derivedStatus === statusFilter)
      .filter(
        (b) =>
          !needle ||
          b.personName.toLowerCase().includes(needle) ||
          b.reference.toLowerCase().includes(needle),
      )
      .sort((a, b) => (b.created?.toMillis() ?? 0) - (a.created?.toMillis() ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, statusFilter, search, users])

  if (loading) return <PageLoading />

  const totals = billTotals(data, nowMs)
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const selectedAmount = selectedRows.reduce((s, r) => s + (r.amount ?? 0), 0)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <StatCards
        cards={[
          { label: "Offen", value: formatCHF(totals.openAmount) },
          {
            label: "Überfällig",
            value: formatCHF(totals.overdueAmount),
            tone: "text-destructive",
          },
          {
            label: "Bezahlt (Monat)",
            value: formatCHF(totals.paidThisMonthAmount),
          },
          { label: "Anzahl offen", value: totals.openCount },
        ]}
      />

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Person oder Rechnungs-Nr. …"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {selectedRows.length > 0 && (
        <BulkBar
          label={`${selectedRows.length} ausgewählt · ${formatCHF(selectedAmount)}`}
        >
          <Button size="sm" onClick={() => setMarkPaidOpen(true)}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Als bezahlt markieren
          </Button>
        </BulkBar>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Keine Rechnungen"
          description="Für diesen Filter sind keine Rechnungen vorhanden."
        />
      ) : (
        <Card className="px-4 py-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Nr.</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Betrag</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((bill) => {
                const payable =
                  bill.derivedStatus === "open" ||
                  bill.derivedStatus === "overdue"
                return (
                  <TableRow key={bill.id}>
                    <TableCell>
                      {payable && (
                        <Checkbox
                          checked={selected.has(bill.id)}
                          onCheckedChange={() => toggle(bill.id)}
                          aria-label={`${bill.reference} auswählen`}
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {bill.reference}
                    </TableCell>
                    <TableCell>
                      {bill.userId ? (
                        <Link
                          to="/users/$userId"
                          params={{ userId: bill.userId.id }}
                          className="font-medium hover:underline"
                        >
                          {bill.personName}
                        </Link>
                      ) : (
                        "–"
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDate(bill.created)}
                    </TableCell>
                    <TableCell>
                      <BillStatusBadge status={bill.derivedStatus} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCHF(bill.amount ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to="/invoices/$billId"
                        params={{ billId: bill.id }}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        öffnen
                        <MoveRight className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <MarkPaidDialog
        open={markPaidOpen}
        onOpenChange={setMarkPaidOpen}
        billIds={selectedRows.map((r) => r.id)}
        summary={`${selectedRows.length} Rechnung(en) · ${formatCHF(selectedAmount)}`}
        onDone={() => setSelected(new Set())}
      />
    </div>
  )
}
