// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { membershipsCollection } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import type { MembershipDoc } from "@modules/lib/firestore-entities"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@modules/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { Badge } from "@modules/components/ui/badge"
import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { formatDate } from "@modules/lib/format"
import { orderBy } from "firebase/firestore"

export const Route = createFileRoute("/_authenticated/memberships/")({
  component: MembershipsPage,
})

type MembershipRow = MembershipDoc & { id: string }

function MembershipsPage() {
  const db = useDb()
  // Newest-first ordering by validUntil so expiring soon bubbles up.
  const { data, loading } = useCollection(
    membershipsCollection(db),
    orderBy("validUntil", "asc"),
  )

  const columns = useMemo<ColumnDef<MembershipRow>[]>(
    () => [
      {
        id: "owner",
        header: ({ column }) => <ColumnHeader column={column} title="Inhaber:in" />,
        accessorFn: (row) => row.ownerUserId.id,
        cell: ({ row }) => (
          <Link
            to="/users/$userId"
            params={{ userId: row.original.ownerUserId.id }}
            className="font-mono text-xs hover:underline"
          >
            {row.original.ownerUserId.id}
          </Link>
        ),
      },
      {
        accessorKey: "type",
        header: ({ column }) => <ColumnHeader column={column} title="Typ" />,
        cell: ({ row }) => (
          <Badge variant={row.original.type === "family" ? "default" : "secondary"}>
            {row.original.type === "family" ? "Familie" : "Einzel"}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <ColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
          const status = row.original.status
          const variant =
            status === "active"
              ? "default"
              : status === "expired"
                ? "destructive"
                : "outline"
          return <Badge variant={variant}>{status}</Badge>
        },
      },
      {
        id: "members",
        header: "Mitglieder",
        accessorFn: (row) => row.members?.length ?? 0,
        cell: ({ row }) => row.original.members?.length ?? 0,
      },
      {
        id: "validUntil",
        header: ({ column }) => <ColumnHeader column={column} title="Gültig bis" />,
        accessorFn: (row) => row.validUntil?.toMillis?.() ?? 0,
        cell: ({ row }) => formatDate(row.original.validUntil),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Link
            to="/memberships/$membershipId"
            params={{ membershipId: row.original.id }}
            className="text-sm text-primary hover:underline"
          >
            Details
          </Link>
        ),
        enableSorting: false,
      },
    ],
    [],
  )

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader title="Mitgliedschaften" />
      <DataTable columns={columns} data={data} />
    </div>
  )
}
