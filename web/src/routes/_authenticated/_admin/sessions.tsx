// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@/components/ui/badge"
import { formatDateTime } from "@/lib/format"
import { type ColumnDef } from "@tanstack/react-table"

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

const columns: ColumnDef<UsageMachineDoc & { id: string }>[] = [
  {
    accessorKey: "machine",
    header: ({ column }) => <ColumnHeader column={column} title="Maschine" />,
    cell: ({ row }) => row.original.machine?.id ?? "–",
  },
  {
    accessorKey: "userId",
    header: ({ column }) => <ColumnHeader column={column} title="Benutzer" />,
    cell: ({ row }) => row.original.userId?.id ?? "–",
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
]

function SessionsPage() {
  const { data, loading } = useCollection<UsageMachineDoc>("usage_machine")

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Sitzungen" />
      <DataTable columns={columns} data={data} searchKey="machine" searchPlaceholder="Maschine suchen..." />
    </div>
  )
}
