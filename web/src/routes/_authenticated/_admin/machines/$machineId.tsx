// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useDocument, useCollection } from "@/lib/firestore"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { permissionRef, macoRef } from "@/lib/firestore-helpers"
import { PageLoading } from "@/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { useEffect, useState } from "react"
import { type DocumentReference } from "firebase/firestore"

export const Route = createFileRoute(
  "/_authenticated/_admin/machines/$machineId",
)({
  component: MachineDetailPage,
})

interface MachineDoc {
  name: string
  requiredPermission: (DocumentReference | { id: string })[]
  maco?: DocumentReference | { id: string } | null
}

interface PermissionDoc {
  name: string
}

interface MacoDoc {
  name: string
}

function MachineDetailPage() {
  const { machineId } = Route.useParams()
  const { data: machine, loading } = useDocument<MachineDoc>(
    `machine/${machineId}`,
  )
  const { data: allPermissions } = useCollection<PermissionDoc>("permission")
  const { data: allMacos } = useCollection<MacoDoc>("maco")
  const { update, loading: saving } = useFirestoreMutation()
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])

  const { register, handleSubmit, reset } = useForm<{
    name: string
    macoId: string
  }>()

  useEffect(() => {
    if (machine) {
      const perms = (machine.requiredPermission ?? []).map((p) =>
        typeof p === "string" ? p : p.id,
      )
      setSelectedPermissions(perms)
      reset({
        name: machine.name,
        macoId: machine.maco
          ? typeof machine.maco === "string"
            ? machine.maco
            : machine.maco.id
          : "",
      })
    }
  }, [machine, reset])

  if (loading) return <PageLoading />
  if (!machine) return <div>Maschine nicht gefunden.</div>

  const onSubmit = async (values: { name: string; macoId: string }) => {
    await update(
      "machine",
      machineId,
      {
        name: values.name,
        requiredPermission: selectedPermissions.map((id) =>
          permissionRef(id),
        ),
        maco: values.macoId ? macoRef(values.macoId) : null,
      },
      {
        successMessage: "Maschine gespeichert",
      },
    )
  }

  const togglePermission = (permId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId)
        ? prev.filter((p) => p !== permId)
        : [...prev, permId],
    )
  }

  return (
    <div>
      <PageHeader
        title={machine.name || "Maschine"}
        backTo="/machines"
        backLabel="Zurück zu Maschinen"
      />
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4 max-w-lg"
          >
            <div className="space-y-2">
              <Label>ID</Label>
              <Input value={machineId} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="machine-name">Name</Label>
              <Input id="machine-name" {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="machine-maco">Terminal</Label>
              <select
                id="machine-maco"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                {...register("macoId")}
              >
                <option value="">– Kein Terminal –</option>
                {allMacos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Erforderliche Berechtigungen</Label>
              <div className="flex flex-wrap gap-2">
                {allPermissions.map((perm) => (
                  <Badge
                    key={perm.id}
                    variant={
                      selectedPermissions.includes(perm.id)
                        ? "default"
                        : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => togglePermission(perm.id)}
                  >
                    {perm.name || perm.id}
                  </Badge>
                ))}
              </div>
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
    </div>
  )
}
