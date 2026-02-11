// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { PageLoading } from "@/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { DataTable, ColumnHeader } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2, Loader2 } from "lucide-react"
import { useMemo, useState } from "react"
import { serverTimestamp } from "firebase/firestore"
import { type ColumnDef } from "@tanstack/react-table"

export const Route = createFileRoute("/_authenticated/_admin/permissions/")({
  component: PermissionsPage,
})

interface PermissionDoc {
  name: string
}

interface RefHolder {
  permissions?: { id: string }[]
  requiredPermission?: { id: string }[]
}

function PermissionsPage() {
  const { data, loading } = useCollection<PermissionDoc>("permission")
  const { data: users } = useCollection<RefHolder & { displayName?: string }>("users")
  const { data: machines } = useCollection<RefHolder & { name?: string }>("machine")
  const { add, remove, loading: saving } = useFirestoreMutation()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const referenceInfo = useMemo(() => {
    if (!deleteTarget) return null
    const id = deleteTarget.id
    const referencingUsers = users.filter((u) =>
      (u.permissions ?? []).some((p) => p.id === id)
    )
    const referencingMachines = machines.filter((m) =>
      (m.requiredPermission ?? []).some((p) => p.id === id)
    )
    return { users: referencingUsers, machines: referencingMachines }
  }, [deleteTarget, users, machines])

  const hasReferences = referenceInfo
    ? referenceInfo.users.length > 0 || referenceInfo.machines.length > 0
    : false

  const columns = useMemo<ColumnDef<PermissionDoc & { id: string }>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <ColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Link
            to="/permissions/$permissionId"
            params={{ permissionId: row.original.id }}
            className="font-medium hover:underline"
          >
            {row.getValue("name")}
          </Link>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget({ id: row.original.id, name: row.original.name })}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ),
        enableSorting: false,
      },
    ],
    []
  )

  if (loading) return <PageLoading />

  const handleDelete = async () => {
    if (!deleteTarget || hasReferences) return
    await remove("permission", deleteTarget.id, {
      successMessage: "Berechtigung gelöscht",
    })
    setDeleteTarget(null)
  }

  const deleteDescription = (() => {
    if (!deleteTarget || !referenceInfo) return ""
    if (!hasReferences) {
      return `Soll die Berechtigung "${deleteTarget.name}" wirklich gelöscht werden?`
    }
    const parts: string[] = []
    if (referenceInfo.users.length > 0) {
      const names = referenceInfo.users.map((u) => u.displayName || u.id).join(", ")
      parts.push(`Benutzer: ${names}`)
    }
    if (referenceInfo.machines.length > 0) {
      const names = referenceInfo.machines.map((m) => m.name || m.id).join(", ")
      parts.push(`Maschinen: ${names}`)
    }
    return (
      <span>
        Die Berechtigung &ldquo;{deleteTarget.name}&rdquo; wird noch verwendet und kann nicht gelöscht werden.
        <br /><br />
        {parts.map((p, i) => <span key={i}>{p}<br /></span>)}
      </span>
    )
  })()

  return (
    <div>
      <PageHeader
        title="Berechtigungen"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Berechtigung erstellen
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Berechtigung suchen..."
      />

      <CreatePermissionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={async (name, description) => {
          await add("permission", {
            name,
            description: description || null,
            created: serverTimestamp(),
          }, {
            successMessage: "Berechtigung erstellt",
          })
        }}
        saving={saving}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Berechtigung löschen"
        description={deleteDescription}
        confirmLabel="Löschen"
        destructive
        confirmDisabled={hasReferences}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function CreatePermissionDialog({
  open,
  onOpenChange,
  onSubmit,
  saving,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, description: string) => Promise<void>
  saving: boolean
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await onSubmit(name.trim(), description.trim())
    setName("")
    setDescription("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Berechtigung erstellen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="perm-name">Name</Label>
            <Input
              id="perm-name"
              placeholder="z.B. Laserschneiden"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="perm-description">Beschreibung</Label>
            <Textarea
              id="perm-description"
              placeholder="Optionale Beschreibung..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Erstellen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
