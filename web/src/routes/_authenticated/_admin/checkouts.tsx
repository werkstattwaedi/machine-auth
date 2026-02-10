// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { formatDateTime, formatCHF } from "@/lib/format"
import { type ColumnDef } from "@tanstack/react-table"

export const Route = createFileRoute("/_authenticated/_admin/checkouts")({
  component: CheckoutsPage,
})

interface CheckoutDoc {
  userId?: { id: string } | null
  time?: { toDate(): Date }
  totalPrice?: number
  tip?: number
  persons?: { name: string; email: string }[]
}

const columns: ColumnDef<CheckoutDoc & { id: string }>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <ColumnHeader column={column} title="ID" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.id}</span>,
  },
  {
    accessorKey: "time",
    header: ({ column }) => <ColumnHeader column={column} title="Datum" />,
    cell: ({ row }) => formatDateTime(row.original.time),
  },
  {
    accessorKey: "persons",
    header: "Person(en)",
    cell: ({ row }) => {
      const persons = row.original.persons ?? []
      return persons.length > 0
        ? persons.map((p) => p.name).join(", ")
        : row.original.userId?.id ?? "–"
    },
    enableSorting: false,
  },
  {
    accessorKey: "totalPrice",
    header: ({ column }) => <ColumnHeader column={column} title="Total" />,
    cell: ({ row }) =>
      row.original.totalPrice != null ? formatCHF(row.original.totalPrice) : "–",
  },
  {
    accessorKey: "tip",
    header: "Trinkgeld",
    cell: ({ row }) =>
      row.original.tip != null && row.original.tip > 0 ? formatCHF(row.original.tip) : "–",
  },
]

function CheckoutsPage() {
  const { data, loading } = useCollection<CheckoutDoc>("checkouts")

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Checkouts" />
      <DataTable columns={columns} data={data} searchKey="id" searchPlaceholder="Checkout suchen..." />
    </div>
  )
}
