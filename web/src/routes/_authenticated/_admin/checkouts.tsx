// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { useLookup, resolveRef } from "@/lib/lookup"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { formatDateTime, formatCHF } from "@/lib/format"
import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

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

function CheckoutsPage() {
  const { data, loading } = useCollection<CheckoutDoc>("checkouts")
  const { users } = useLookup()

  const columns = useMemo<ColumnDef<CheckoutDoc & { id: string }>[]>(
    () => [
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
          if (persons.length > 0) {
            return persons.map((p) => p.name).join(", ")
          }
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
    ],
    [users]
  )

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Checkouts" />
      <DataTable columns={columns} data={data} searchKey="time" searchPlaceholder="Checkout suchen..." />
    </div>
  )
}
