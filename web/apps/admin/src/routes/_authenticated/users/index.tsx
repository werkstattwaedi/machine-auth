// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { usersCollection } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { BadgeList } from "@/components/admin/badge-list"
import { Button } from "@modules/components/ui/button"
import { type ColumnDef } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { CreateUserDialog } from "@/components/admin/create-user-dialog"

export const Route = createFileRoute("/_authenticated/users/")({
  component: UsersPage,
})

type UserListDoc = UserDoc

function UsersPage() {
  const db = useDb()
  const { data, loading } = useCollection(usersCollection(db))
  const { permissions } = useLookup()
  const [createOpen, setCreateOpen] = useState(false)

  const columns = useMemo<ColumnDef<UserListDoc & { id: string }>[]>(
    () => [
      {
        id: "name",
        header: ({ column }) => <ColumnHeader column={column} title="Name" />,
        accessorFn: (row) => `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
        cell: ({ row }) => (
          <Link
            to="/users/$userId"
            params={{ userId: row.original.id }}
            className="font-medium hover:underline"
          >
            {`${row.original.firstName ?? ""} ${row.original.lastName ?? ""}`.trim() || "–"}
          </Link>
        ),
      },
      {
        accessorKey: "email",
        header: ({ column }) => <ColumnHeader column={column} title="E-Mail" />,
        cell: ({ row }) => row.original.email ?? "–",
      },
      {
        accessorKey: "roles",
        header: "Rollen",
        cell: ({ row }) => <BadgeList items={row.original.roles ?? []} />,
        enableSorting: false,
      },
      {
        accessorKey: "permissions",
        header: "Berechtigungen",
        cell: ({ row }) => {
          const perms = (row.original.permissions ?? []).map((p) =>
            resolveRef(permissions, p)
          )
          return <BadgeList items={perms} variant="outline" />
        },
        enableSorting: false,
      },
    ],
    [permissions]
  )

  if (loading) return <PageLoading />

  return (
    <div>
      <PageHeader
        title="Benutzer"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Benutzer erstellen
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        searchKey="displayName"
        searchPlaceholder="Name suchen..."
      />
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
