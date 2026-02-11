// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useDocument, useCollection } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { permissionRef } from "@/lib/firestore-helpers"
import { PageLoading } from "@/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useForm } from "react-hook-form"
import { Loader2, Save, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { type DocumentReference } from "firebase/firestore"

export const Route = createFileRoute(
  "/_authenticated/_admin/permissions/$permissionId",
)({
  component: PermissionDetailPage,
})

interface PermissionDoc {
  name: string
  description?: string
}

interface UserDoc {
  displayName?: string
  name?: string
  permissions?: (DocumentReference | { id: string })[]
}

interface MachineDoc {
  name?: string
  requiredPermission?: (DocumentReference | { id: string })[]
}

interface PermissionFormValues {
  name: string
  description: string
}

function PermissionDetailPage() {
  const { permissionId } = Route.useParams()
  const { data: permission, loading } = useDocument<PermissionDoc>(
    `permission/${permissionId}`,
  )
  const { data: allUsers } = useCollection<UserDoc>("users")
  const { data: allMachines } = useCollection<MachineDoc>("machine")
  const { update, loading: saving } = useFirestoreMutation()
  const [revokeTarget, setRevokeTarget] = useState<{
    type: "user" | "machine"
    id: string
    name: string
  } | null>(null)

  const { register, handleSubmit, reset } = useForm<PermissionFormValues>()

  useEffect(() => {
    if (permission) {
      reset({
        name: permission.name,
        description: permission.description ?? "",
      })
    }
  }, [permission, reset])

  const referencingUsers = useMemo(
    () =>
      allUsers.filter((u) =>
        (u.permissions ?? []).some((p) => p.id === permissionId),
      ),
    [allUsers, permissionId],
  )

  const referencingMachines = useMemo(
    () =>
      allMachines.filter((m) =>
        (m.requiredPermission ?? []).some((p) => p.id === permissionId),
      ),
    [allMachines, permissionId],
  )

  if (loading) return <PageLoading />
  if (!permission) return <div>Berechtigung nicht gefunden.</div>

  const onSubmit = async (values: PermissionFormValues) => {
    await update(
      "permission",
      permissionId,
      {
        name: values.name,
        description: values.description || null,
      },
      { successMessage: "Berechtigung gespeichert" },
    )
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return

    if (revokeTarget.type === "user") {
      const user = allUsers.find((u) => u.id === revokeTarget.id)
      if (!user) return
      const filtered = (user.permissions ?? [])
        .filter((p) => p.id !== permissionId)
        .map((p) => permissionRef(p.id))
      await update("users", revokeTarget.id, { permissions: filtered }, {
        successMessage: "Berechtigung entfernt",
      })
    } else {
      const machine = allMachines.find((m) => m.id === revokeTarget.id)
      if (!machine) return
      const filtered = (machine.requiredPermission ?? [])
        .filter((p) => p.id !== permissionId)
        .map((p) => permissionRef(p.id))
      await update("machine", revokeTarget.id, { requiredPermission: filtered }, {
        successMessage: "Berechtigung entfernt",
      })
    }

    setRevokeTarget(null)
  }

  return (
    <div>
      <PageHeader
        title={permission.name || "Berechtigung"}
        backTo="/permissions"
        backLabel="Zurück zu Berechtigungen"
      />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 max-w-lg"
          >
            <div className="space-y-2">
              <Label htmlFor="perm-name">Name</Label>
              <Input id="perm-name" {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="perm-description">Beschreibung</Label>
              <Textarea
                id="perm-description"
                placeholder="Optionale Beschreibung..."
                {...register("description")}
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Speichern
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verwendet von</CardTitle>
          <p className="text-sm text-muted-foreground">
            {referencingUsers.length} Benutzer, {referencingMachines.length}{" "}
            Maschinen
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {referencingUsers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Benutzer</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-24">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referencingUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Link
                          to="/users/$userId"
                          params={{ userId: user.id }}
                          className="hover:underline"
                        >
                          {user.displayName || user.name || user.id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setRevokeTarget({
                              type: "user",
                              id: user.id,
                              name: user.displayName || user.name || user.id,
                            })
                          }
                        >
                          <X className="h-3 w-3 mr-1" />
                          Entfernen
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {referencingMachines.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Maschinen</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-24">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referencingMachines.map((machine) => (
                    <TableRow key={machine.id}>
                      <TableCell>
                        <Link
                          to="/machines/$machineId"
                          params={{ machineId: machine.id }}
                          className="hover:underline"
                        >
                          {machine.name || machine.id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setRevokeTarget({
                              type: "machine",
                              id: machine.id,
                              name: machine.name || machine.id,
                            })
                          }
                        >
                          <X className="h-3 w-3 mr-1" />
                          Entfernen
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {referencingUsers.length === 0 &&
            referencingMachines.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Diese Berechtigung wird aktuell nicht verwendet.
              </p>
            )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Berechtigung entfernen"
        description={
          revokeTarget
            ? `Soll die Berechtigung "${permission.name}" von "${revokeTarget.name}" entfernt werden?`
            : ""
        }
        confirmLabel="Entfernen"
        destructive
        onConfirm={handleRevoke}
      />
    </div>
  )
}
