// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Nutzungen — the shared machine-usage table. Reached from the sidebar
// (unfiltered) or deep-linked from a person / machine page with
// `?user=` / `?machine=` pre-applied as removable chips. Each Nutzung
// links to the Besuch (checkout) it was billed under.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { where, orderBy, limit } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  machineRef,
  usageMachineCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import type { UsageMachineDoc } from "@modules/lib/firestore-entities"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { ActiveFilterChip } from "@/components/admin/active-filter-chip"
import { formatDateTime } from "@modules/lib/format"
import { formatDuration } from "@/lib/duration"
import { usageCheckoutId } from "@/lib/usage-helpers"
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
import { History, MoveRight } from "lucide-react"

interface UsagesSearch {
  user?: string
  machine?: string
}

export const Route = createFileRoute("/_authenticated/usages")({
  validateSearch: (search: Record<string, unknown>): UsagesSearch => ({
    user: typeof search.user === "string" ? search.user : undefined,
    machine: typeof search.machine === "string" ? search.machine : undefined,
  }),
  component: UsagesPage,
})

function UsagesPage() {
  const { user, machine } = Route.useSearch()
  const navigate = useNavigate()
  const { users, machines } = useLookup()

  return (
    <div className="space-y-4">
      <PageHeader title="Nutzungen" />
      {(user || machine) && (
        <div className="flex flex-wrap gap-1.5">
          {user && (
            <ActiveFilterChip
              label="Person"
              value={users.get(user) ?? user}
              onRemove={() =>
                navigate({
                  to: "/usages",
                  search: { user: undefined, machine },
                })
              }
            />
          )}
          {machine && (
            <ActiveFilterChip
              label="Maschine"
              value={machines.get(machine) ?? machine}
              onRemove={() =>
                navigate({
                  to: "/usages",
                  search: { user, machine: undefined },
                })
              }
            />
          )}
        </div>
      )}
      {/* Key by filter so useCollection re-subscribes when the query
          constraints change (it only watches the collection path). */}
      <UsagesTable key={`${user ?? ""}|${machine ?? ""}`} userId={user} machineId={machine} />
    </div>
  )
}

function UsagesTable({
  userId,
  machineId,
}: {
  userId?: string
  machineId?: string
}) {
  const db = useDb()
  const { users, machines } = useLookup()

  // Filtered views use equality-only queries (zig-zag merge, no composite
  // index) and sort client-side; the unfiltered view orders server-side.
  const constraints = []
  if (userId) constraints.push(where("userId", "==", userRef(db, userId)))
  if (machineId)
    constraints.push(where("machine", "==", machineRef(db, machineId)))
  if (constraints.length === 0) {
    constraints.push(orderBy("startTime", "desc"), limit(200))
  } else {
    constraints.push(limit(500))
  }

  const { data, loading } = useCollection(
    usageMachineCollection(db),
    ...constraints,
  )

  if (loading) return <PageLoading />

  const rows = [...data].sort(
    (a, b) => (b.startTime?.toMillis() ?? 0) - (a.startTime?.toMillis() ?? 0),
  )

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Keine Nutzungen"
        description="Für diesen Filter sind keine Maschinen-Nutzungen erfasst."
      />
    )
  }

  return (
    <Card className="px-4 py-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Datum / Zeit</TableHead>
            <TableHead>Person</TableHead>
            <TableHead>Maschine</TableHead>
            <TableHead>Dauer</TableHead>
            <TableHead className="text-right">Besuch</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((usage: UsageMachineDoc & { id: string }) => {
            const checkoutId = usageCheckoutId(usage.checkoutItemRef)
            return (
              <TableRow key={usage.id}>
                <TableCell className="tabular-nums">
                  {formatDateTime(usage.startTime)}
                </TableCell>
                <TableCell>
                  {usage.userId ? (
                    <Link
                      to="/users/$userId"
                      params={{ userId: usage.userId.id }}
                      className="font-medium hover:underline"
                    >
                      {resolveRef(users, usage.userId)}
                    </Link>
                  ) : (
                    "–"
                  )}
                </TableCell>
                <TableCell>
                  {usage.machine ? (
                    <Link
                      to="/machines/$machineId"
                      params={{ machineId: usage.machine.id }}
                      className="hover:underline"
                    >
                      {resolveRef(machines, usage.machine)}
                    </Link>
                  ) : (
                    "–"
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatDuration(usage.startTime, usage.endTime)}
                </TableCell>
                <TableCell className="text-right">
                  {checkoutId ? (
                    <Link
                      to="/visits/$checkoutId"
                      params={{ checkoutId }}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Besuch
                      <MoveRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
