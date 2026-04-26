// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { orderBy, limit } from "firebase/firestore"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@modules/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@modules/components/ui/badge"
import { formatDateTime } from "@modules/lib/format"
import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

export const Route = createFileRoute("/_authenticated/sessions")({
  component: SessionsPage,
})

interface UsageMachineDoc {
  userId?: { id: string }
  machine?: { id: string }
  startTime?: { toDate(): Date }
  endTime?: { toDate(): Date }
  endReason?: string
  checkoutItemRef?: { id: string; parent: { parent: { id: string } } } | null
  workshop?: string
}

function SessionsPage() {
  const { data, loading } = useCollection<UsageMachineDoc>(
    "usage_machine",
    orderBy("startTime", "desc"),
    limit(200),
  )
  const { machines, users } = useLookup()

  const columns = useMemo<ColumnDef<UsageMachineDoc & { id: string }>[]>(
    () => [
      {
        accessorKey: "machine",
        header: ({ column }) => <ColumnHeader column={column} title="Maschine" />,
        cell: ({ row }) => {
          const ref = row.original.machine
          if (!ref) return "–"
          return (
            <Link
              to="/machines/$machineId"
              params={{ machineId: ref.id }}
              className="hover:underline"
            >
              {resolveRef(machines, ref)}
            </Link>
          )
        },
      },
      {
        accessorKey: "userId",
        header: ({ column }) => <ColumnHeader column={column} title="Benutzer" />,
        cell: ({ row }) => {
          const ref = row.original.userId
          if (!ref) return "–"
          return (
            <Link
              to="/users/$userId"
              params={{ userId: ref.id }}
              className="hover:underline"
            >
              {resolveRef(users, ref)}
            </Link>
          )
        },
      },
      {
        accessorKey: "workshop",
        header: "Werkstatt",
        cell: ({ row }) => row.original.workshop ?? "–",
      },
      {
        accessorKey: "startTime",
        header: ({ column }) => <ColumnHeader column={column} title="Start" />,
        cell: ({ row }) => formatDateTime(row.original.startTime),
      },
      {
        accessorKey: "endTime",
        header: "Ende",
        cell: ({ row }) => formatDateTime(row.original.endTime),
      },
      {
        accessorKey: "checkoutItemRef",
        header: "Checkout",
        cell: ({ row }) => {
          const ref = row.original.checkoutItemRef
          return ref ? (
            <Badge variant="outline">{ref.parent.parent.id}</Badge>
          ) : (
            <span className="text-muted-foreground">–</span>
          )
        },
      },
    ],
    [machines, users]
  )

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Sitzungen" />
      <DataTable columns={columns} data={data} searchKey="machine" searchPlaceholder="Maschine suchen..." />
    </div>
  )
}
