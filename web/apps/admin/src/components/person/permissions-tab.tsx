// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person · Berechtigungen — one card per granted permission with revoke
// right there, plus a picker to grant. "Zuletzt genutzt" joins the
// person's machine usages against the machines requiring the permission
// and deep-links into the Nutzungen ledger.

import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { where } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  machinesCollection,
  permissionRef,
  permissionsCollection,
  usageMachineCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { formatDate } from "@modules/lib/format"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { EmptyState } from "@modules/components/empty-state"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@modules/components/ui/select"
import { Cpu, Key, MoveRight, Plus } from "lucide-react"

export function PersonPermissionsTab({
  userId,
  user,
}: {
  userId: string
  user: UserDoc
}) {
  const db = useDb()
  const { data: allPermissions } = useCollection(permissionsCollection(db))
  const { data: machines } = useCollection(machinesCollection(db))
  const { data: usages } = useCollection(
    usageMachineCollection(db),
    where("userId", "==", userRef(db, userId)),
  )
  const { update, loading: saving } = useFirestoreMutation()
  const [pickedPermission, setPickedPermission] = useState("")

  const grantedIds = (user.permissions ?? []).map((p) =>
    typeof p === "string" ? p : p.id,
  )
  const grantable = allPermissions.filter((p) => !grantedIds.includes(p.id))

  // Last usage per permission: a usage counts for every permission its
  // machine requires. Client-side join over the person's own usages.
  const machinePermissions = new Map(
    machines.map((m) => [
      m.id,
      (m.requiredPermission ?? []).map((p) => p.id),
    ]),
  )
  const lastUsedMs = new Map<string, { ms: number; machineId: string }>()
  for (const usage of usages) {
    const ms = usage.startTime?.toMillis() ?? 0
    for (const permId of machinePermissions.get(usage.machine?.id ?? "") ?? []) {
      const prev = lastUsedMs.get(permId)
      if (!prev || ms > prev.ms) {
        lastUsedMs.set(permId, { ms, machineId: usage.machine.id })
      }
    }
  }

  const setPermissions = async (ids: string[]) => {
    await update(
      userRef(db, userId),
      { permissions: ids.map((id) => permissionRef(db, id)) },
      { successMessage: "Berechtigungen aktualisiert" },
    )
  }

  const handleGrant = async () => {
    if (!pickedPermission) return
    await setPermissions([...grantedIds, pickedPermission])
    setPickedPermission("")
  }

  return (
    <div className="mt-2 max-w-2xl space-y-4">
      <div className="flex gap-2">
        <Select value={pickedPermission} onValueChange={setPickedPermission}>
          <SelectTrigger className="max-w-72">
            <SelectValue placeholder="Berechtigung wählen …" />
          </SelectTrigger>
          <SelectContent>
            {grantable.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name || p.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handleGrant}
          disabled={!pickedPermission || saving}
        >
          <Plus className="mr-2 h-4 w-4" />
          Erteilen
        </Button>
      </div>

      {grantedIds.length === 0 ? (
        <EmptyState
          icon={Key}
          title="Keine Berechtigungen"
          description="Diese Person hat noch keine Maschinen-Berechtigungen."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {grantedIds.map((permId) => {
            const perm = allPermissions.find((p) => p.id === permId)
            const last = lastUsedMs.get(permId)
            return (
              <Card key={permId}>
                <CardContent className="space-y-2.5 pt-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <Cpu className="h-4 w-4 text-cog-teal-dark" />
                      {perm?.name ?? permId}
                    </div>
                    <Badge variant="secondary">aktiv</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {last ? (
                      <Link
                        to="/usages"
                        search={{ user: userId, machine: last.machineId }}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        zuletzt genutzt {formatDate(new Date(last.ms))}
                        <MoveRight className="h-3 w-3" />
                      </Link>
                    ) : (
                      "noch nie genutzt"
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={saving}
                    onClick={() =>
                      setPermissions(grantedIds.filter((id) => id !== permId))
                    }
                  >
                    Entziehen
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
