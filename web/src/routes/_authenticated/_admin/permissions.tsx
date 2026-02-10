// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useCollection } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { PageLoading } from "@/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Plus, Trash2, Loader2 } from "lucide-react"
import { useState } from "react"
import { serverTimestamp } from "firebase/firestore"

export const Route = createFileRoute("/_authenticated/_admin/permissions")({
  component: PermissionsPage,
})

interface PermissionDoc {
  name: string
}

function PermissionsPage() {
  const { data, loading } = useCollection<PermissionDoc>("permission")
  const { set, remove, loading: saving } = useFirestoreMutation()
  const [newId, setNewId] = useState("")
  const [newName, setNewName] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  if (loading) return <PageLoading />

  const handleCreate = async () => {
    if (!newId.trim() || !newName.trim()) return
    await set("permission", newId.trim(), {
      name: newName.trim(),
      created: serverTimestamp(),
    }, {
      successMessage: "Berechtigung erstellt",
    })
    setNewId("")
    setNewName("")
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await remove("permission", deleteTarget, {
      successMessage: "Berechtigung gelöscht",
    })
    setDeleteTarget(null)
  }

  return (
    <div>
      <PageHeader title="Berechtigungen" />

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex gap-2 items-end">
              <div className="space-y-1">
                <label className="text-sm font-medium">ID</label>
                <Input
                  placeholder="z.B. laser"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-1 flex-1">
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="z.B. Laserschneiden"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={saving || !newId.trim() || !newName.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Erstellen
              </Button>
            </div>

            <div className="divide-y rounded-md border">
              {data.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  Keine Berechtigungen vorhanden.
                </div>
              ) : (
                data.map((perm) => (
                  <div key={perm.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <span className="font-mono text-xs text-muted-foreground mr-2">{perm.id}</span>
                      <span className="text-sm">{perm.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(perm.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Berechtigung löschen"
        description={`Soll die Berechtigung "${deleteTarget}" wirklich gelöscht werden?`}
        confirmLabel="Löschen"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}
