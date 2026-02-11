// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { useLookup, resolveRef } from "@/lib/lookup"
import { PageLoading } from "@/components/page-loading"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { BadgeList } from "@/components/admin/badge-list"
import { Button } from "@/components/ui/button"
import { type ColumnDef } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { CreateUserDialog } from "@/components/admin/create-user-dialog"

export const Route = createFileRoute("/_authenticated/_admin/users/")({
  component: UsersPage,
})

interface UserListDoc {
  displayName: string
  name: string
  email?: string
  roles: string[]
  permissions: { id: string }[]
}

function UsersPage() {
  const { data, loading } = useCollection<UserListDoc>("users")
  const { permissions } = useLookup()
  const [createOpen, setCreateOpen] = useState(false)

  const columns = useMemo<ColumnDef<UserListDoc & { id: string }>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: ({ column }) => <ColumnHeader column={column} title="Anzeigename" />,
        cell: ({ row }) => (
          <Link
            to="/users/$userId"
            params={{ userId: row.original.id }}
            className="font-medium hover:underline"
          >
            {row.getValue("displayName") || "–"}
          </Link>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => <ColumnHeader column={column} title="Name" />,
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
