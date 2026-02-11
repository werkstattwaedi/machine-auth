// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { useLookup, resolveRef } from "@/lib/lookup"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@/components/ui/badge"
import { formatDateTime } from "@/lib/format"
import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

export const Route = createFileRoute("/_authenticated/_admin/sessions")({
  component: SessionsPage,
})

interface UsageMachineDoc {
  userId?: { id: string }
  machine?: { id: string }
  checkIn?: { toDate(): Date }
  checkOut?: { toDate(): Date } | null
  checkOutReason?: string
  checkout?: { id: string } | null
  workshop?: string
}

function SessionsPage() {
  const { data, loading } = useCollection<UsageMachineDoc>("usage_machine")
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
        accessorKey: "checkIn",
        header: ({ column }) => <ColumnHeader column={column} title="Check-in" />,
        cell: ({ row }) => formatDateTime(row.original.checkIn),
      },
      {
        accessorKey: "checkOut",
        header: "Check-out",
        cell: ({ row }) =>
          row.original.checkOut ? formatDateTime(row.original.checkOut) : (
            <Badge variant="secondary">Aktiv</Badge>
          ),
      },
      {
        accessorKey: "checkout",
        header: "Checkout",
        cell: ({ row }) =>
          row.original.checkout ? (
            <Badge variant="outline">{row.original.checkout.id}</Badge>
          ) : (
            <span className="text-muted-foreground">–</span>
          ),
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
