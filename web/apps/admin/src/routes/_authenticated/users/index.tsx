// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { usersCollection } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { formatFullName } from "@modules/lib/username-utils"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { PageLoading } from "@modules/components/page-loading"
import { DataTable, ColumnHeader } from "@modules/components/data-table"
import { PageHeader } from "@/components/admin/page-header"
import { BadgeList } from "@/components/admin/badge-list"
import { Button } from "@modules/components/ui/button"
import { type ColumnDef } from "@tanstack/react-table"
import { Loader2, Plus, ScanLine } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { CreateUserDialog } from "@/components/admin/create-user-dialog"
import { useTagScan, type ResolveTagResult } from "@/nfc/use-tag-scan"

export const Route = createFileRoute("/_authenticated/users/")({
  component: UsersPage,
})

type UserListDoc = UserDoc

function UsersPage() {
  const db = useDb()
  const navigate = useNavigate()
  const { data, loading } = useCollection(usersCollection(db))
  const { permissions } = useLookup()
  const [createOpen, setCreateOpen] = useState(false)

  // Web NFC: scan a tag and jump to its owner (Chrome/Android only).
  const { supported: nfcSupported, scanTag } = useTagScan()
  const scanMutation = useAsyncMutation<ResolveTagResult>({
    context: "admin.usersScanTag",
    errorMessage: "Tag konnte nicht gelesen werden",
  })

  const handleScanTag = async () => {
    let result
    try {
      result = await scanMutation.mutate(() => scanTag())
    } catch {
      // Hook already toasted + reported telemetry.
      return
    }
    if (result.registered && result.userId) {
      navigate({ to: "/users/$userId", params: { userId: result.userId } })
    } else {
      toast.warning("Tag ist keinem Benutzer zugeordnet.")
    }
  }

  const columns = useMemo<ColumnDef<UserListDoc & { id: string }>[]>(
    () => [
      {
        id: "name",
        header: ({ column }) => <ColumnHeader column={column} title="Name" />,
        accessorFn: (row) => formatFullName(row),
        cell: ({ row }) => (
          <Link
            to="/users/$userId"
            params={{ userId: row.original.id }}
            className="font-medium hover:underline"
          >
            {formatFullName(row.original, "–")}
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
          <div className="flex gap-2">
            {nfcSupported && (
              <Button
                variant="secondary"
                onClick={handleScanTag}
                disabled={scanMutation.loading}
              >
                {scanMutation.loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ScanLine className="h-4 w-4 mr-2" />
                )}
                Tag scannen
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Benutzer erstellen
            </Button>
          </div>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Name suchen..."
      />
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
