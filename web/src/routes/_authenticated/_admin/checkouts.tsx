// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { orderBy, limit } from "firebase/firestore"
import { useLookup, resolveRef } from "@/lib/lookup"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@/components/ui/badge"
import { formatDateTime, formatCHF } from "@/lib/format"
import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

export const Route = createFileRoute("/_authenticated/_admin/checkouts")({
  component: CheckoutsPage,
})

interface CheckoutDoc {
  userId?: { id: string } | null
  status: "open" | "closed"
  usageType?: string
  created?: { toDate(): Date }
  closedAt?: { toDate(): Date }
  workshopsVisited?: string[]
  persons?: { name: string; email: string }[]
  summary?: {
    totalPrice: number
    entryFees: number
    machineCost: number
    materialCost: number
    tip: number
  }
}

function CheckoutsPage() {
  const { data, loading } = useCollection<CheckoutDoc>(
    "checkouts",
    orderBy("created", "desc"),
    limit(100),
  )
  const { users } = useLookup()

  const columns = useMemo<ColumnDef<CheckoutDoc & { id: string }>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.status === "open" ? (
            <Badge variant="secondary">Offen</Badge>
          ) : (
            <Badge variant="outline">Geschlossen</Badge>
          ),
      },
      {
        accessorKey: "created",
        header: ({ column }) => <ColumnHeader column={column} title="Erstellt" />,
        cell: ({ row }) => formatDateTime(row.original.created),
      },
      {
        accessorKey: "closedAt",
        header: ({ column }) => <ColumnHeader column={column} title="Geschlossen" />,
        cell: ({ row }) => formatDateTime(row.original.closedAt),
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
        accessorKey: "usageType",
        header: "Nutzungsart",
        cell: ({ row }) => row.original.usageType ?? "–",
      },
      {
        accessorKey: "workshopsVisited",
        header: "Werkstätten",
        cell: ({ row }) =>
          row.original.workshopsVisited?.join(", ") ?? "–",
      },
      {
        id: "totalPrice",
        header: ({ column }) => <ColumnHeader column={column} title="Total" />,
        cell: ({ row }) =>
          row.original.summary?.totalPrice != null
            ? formatCHF(row.original.summary.totalPrice)
            : "–",
      },
      {
        id: "tip",
        header: "Trinkgeld",
        cell: ({ row }) =>
          row.original.summary?.tip != null && row.original.summary.tip > 0
            ? formatCHF(row.original.summary.tip)
            : "–",
      },
    ],
    [users]
  )

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Checkouts" />
      <DataTable columns={columns} data={data} searchKey="status" searchPlaceholder="Checkout suchen..." />
    </div>
  )
}
