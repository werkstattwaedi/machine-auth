// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Besuche — the shared visit (checkout) list. A Besuch is one workshop
// visit with its open/billed checkout; its Nutzungen and material
// positions roll up inside it. Reached unfiltered from the sidebar or
// deep-linked from a person page with `?user=` pre-applied.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { where, orderBy, limit } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  checkoutsCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { ActiveFilterChip } from "@/components/admin/active-filter-chip"
import { FilterPills } from "@/components/admin/filter-pills"
import { formatCHF, formatDateTime } from "@modules/lib/format"
import { Badge } from "@modules/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { Card } from "@modules/components/ui/card"
import { EmptyState } from "@modules/components/empty-state"
import { ClipboardList, MoveRight } from "lucide-react"

type StatusFilter = "all" | "open" | "closed"

interface VisitsSearch {
  user?: string
  status?: "open" | "closed"
}

export const Route = createFileRoute("/_authenticated/visits/")({
  validateSearch: (search: Record<string, unknown>): VisitsSearch => ({
    user: typeof search.user === "string" ? search.user : undefined,
    status:
      search.status === "open" || search.status === "closed"
        ? search.status
        : undefined,
  }),
  component: VisitsPage,
})

function VisitsPage() {
  const { user, status } = Route.useSearch()
  const navigate = useNavigate()
  const { users } = useLookup()

  const statusFilter: StatusFilter = status ?? "all"

  return (
    <div className="space-y-4">
      <PageHeader title="Besuche" />
      <div className="flex flex-wrap items-center gap-1.5">
        {user && (
          <ActiveFilterChip
            label="Person"
            value={users.get(user) ?? user}
            onRemove={() =>
              navigate({ to: "/visits", search: { user: undefined, status } })
            }
          />
        )}
        <FilterPills<StatusFilter>
          options={[
            { value: "all", label: "Alle" },
            { value: "open", label: "Offen" },
            { value: "closed", label: "Abgerechnet" },
          ]}
          value={statusFilter}
          onChange={(v) =>
            navigate({
              to: "/visits",
              search: { user, status: v === "all" ? undefined : v },
            })
          }
        />
      </div>
      {/* Keyed so useCollection re-subscribes when the person filter
          changes (constraints aren't part of its subscription key). */}
      <VisitsTable key={user ?? ""} userId={user} statusFilter={statusFilter} />
    </div>
  )
}

function VisitsTable({
  userId,
  statusFilter,
}: {
  userId?: string
  statusFilter: StatusFilter
}) {
  const db = useDb()
  const { users } = useLookup()

  // Person filter = equality-only query (no composite index needed);
  // status is filtered client-side so pill toggles don't re-query.
  const constraints = userId
    ? [where("userId", "==", userRef(db, userId)), limit(500)]
    : [orderBy("created", "desc"), limit(200)]

  const { data, loading } = useCollection(checkoutsCollection(db), ...constraints)

  if (loading) return <PageLoading />

  const rows = data
    .filter((c) => statusFilter === "all" || c.status === statusFilter)
    .sort((a, b) => (b.created?.toMillis() ?? 0) - (a.created?.toMillis() ?? 0))

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Keine Besuche"
        description="Für diesen Filter sind keine Besuche vorhanden."
      />
    )
  }

  return (
    <Card className="px-4 py-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Datum</TableHead>
            <TableHead>Person(en)</TableHead>
            <TableHead>Werkstätten</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((visit) => (
            <TableRow key={visit.id}>
              <TableCell className="tabular-nums">
                {formatDateTime(visit.created)}
              </TableCell>
              <TableCell>
                {visit.persons?.length ? (
                  visit.persons.map((p) => p.name).join(", ")
                ) : visit.userId ? (
                  resolveRef(users, visit.userId)
                ) : (
                  <span className="text-muted-foreground">anonym</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {visit.workshopsVisited?.join(", ") || "–"}
              </TableCell>
              <TableCell>
                {visit.status === "open" ? (
                  <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
                    offen
                  </Badge>
                ) : (
                  <Badge variant="secondary">abgerechnet</Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {visit.summary?.totalPrice != null
                  ? formatCHF(visit.summary.totalPrice)
                  : "–"}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  to="/visits/$checkoutId"
                  params={{ checkoutId: visit.id }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  öffnen
                  <MoveRight className="h-3.5 w-3.5" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
