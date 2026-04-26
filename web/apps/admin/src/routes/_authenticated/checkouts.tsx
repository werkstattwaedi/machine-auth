// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { orderBy, limit } from "firebase/firestore"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { useDb } from "@modules/lib/firebase-context"
import { checkoutsCollection } from "@modules/lib/firestore-helpers"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@modules/components/ui/badge"
import { formatDateTime, formatCHF } from "@modules/lib/format"
import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

export const Route = createFileRoute("/_authenticated/checkouts")({
  component: CheckoutsPage,
})

function CheckoutsPage() {
  const db = useDb()
  const { data, loading } = useCollection(
    checkoutsCollection(db),
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
