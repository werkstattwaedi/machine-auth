// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person · Berechtigungen — one card per granted permission with revoke
// right there, plus a picker to grant. Each card says since when and by
// whom (#843, ADM-16). "Zuletzt genutzt" joins the person's machine usages
// against the machines requiring the permission and deep-links into the
// Nutzungen ledger. Grants go through the grantPermission/revokePermission
// callables: the rules pin `permissions` for every client.

import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { where } from "firebase/firestore"
import {
  grantedPermissionIds,
  permissionGrantOf,
  type PermissionGrant,
} from "@oww/shared"
import { useCollection } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import {
  machinesCollection,
  permissionsCollection,
  usageMachineCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import type { UserDoc } from "@modules/lib/firestore-entities"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useLookup } from "@modules/lib/lookup"
import { rpcCallable } from "@modules/lib/rpc"
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
  const functions = useFunctions()
  const { users: userNames } = useLookup()
  const { data: allPermissions } = useCollection(permissionsCollection(db))
  const { data: machines } = useCollection(machinesCollection(db))
  const { data: usages } = useCollection(
    usageMachineCollection(db),
    where("userId", "==", userRef(db, userId)),
  )
  const grantMutation = useAsyncMutation({
    context: "admin.permissions.grant",
    successMessage: "Berechtigung erteilt",
    errorMessage: "Berechtigung konnte nicht erteilt werden",
  })
  const revokeMutation = useAsyncMutation({
    context: "admin.permissions.revoke",
    successMessage: "Berechtigung entzogen",
    errorMessage: "Berechtigung konnte nicht entzogen werden",
  })
  const saving = grantMutation.loading || revokeMutation.loading
  const [pickedPermission, setPickedPermission] = useState("")

  const grantedIds = grantedPermissionIds(user.permissions)
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

  const handleGrant = async () => {
    if (!pickedPermission) return
    try {
      await grantMutation.mutate(async () => {
        await rpcCallable(functions, "authCall", "grantPermission")({
          userId,
          permissionId: pickedPermission,
        })
      })
    } catch {
      return
    }
    setPickedPermission("")
  }

  const handleRevoke = async (permissionId: string) => {
    try {
      await revokeMutation.mutate(async () => {
        await rpcCallable(functions, "authCall", "revokePermission")({
          userId,
          permissionId,
        })
      })
    } catch {
      // The hook toasted.
    }
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
            const grant = permissionGrantOf(user.permissions, permId)
            const temporary = !!grant?.windows
            const last = lastUsedMs.get(permId)
            return (
              <Card key={permId}>
                <CardContent className="space-y-2.5 pt-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <Cpu className="h-4 w-4 text-cog-teal-dark" />
                      {perm?.name ?? permId}
                    </div>
                    <Badge variant="secondary">
                      {temporary ? "vorläufig" : "aktiv"}
                    </Badge>
                  </div>
                  {grant && (
                    <div className="text-sm text-muted-foreground">
                      {grantLine(grant, userNames)}
                    </div>
                  )}
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
                    onClick={() => handleRevoke(permId)}
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

/** «seit 3.11.2026 · von Mike Schneider», from a course: «… · aus einem Kurs». */
export function grantLine(
  grant: PermissionGrant,
  userNames: ReadonlyMap<string, string>,
): string {
  const parts = [
    grant.grantedAt
      ? `seit ${formatDate(new Date(grant.grantedAt.toMillis()))}`
      : "seit unbekanntem Datum",
  ]
  if (grant.grantedBy) {
    parts.push(`von ${userNames.get(grant.grantedBy.id) ?? "unbekannt"}`)
  }
  if (grant.source === "course") parts.push("aus einem Kurs")
  return parts.join(" · ")
}
