// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person · Badges — the person's NFC tags. Add by Web-NFC scan (Chrome/
// Android) or by typing the UID; deactivate/reactivate existing tags.

import { useState } from "react"
import { where, serverTimestamp } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import { tokenRef, tokensCollection, userRef } from "@modules/lib/firestore-helpers"
import type { TokenDoc } from "@modules/lib/firestore-entities"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { formatDateTime } from "@modules/lib/format"
import { PageLoading } from "@modules/components/page-loading"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { Input } from "@modules/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { Ban, Loader2, Plus, RotateCcw, ScanLine } from "lucide-react"
import { toast } from "sonner"
import { useTagScan, type ResolveTagResult } from "@/nfc/use-tag-scan"

export function PersonBadgesTab({ userId }: { userId: string }) {
  const db = useDb()
  const { data: tokens, loading } = useCollection(
    tokensCollection(db),
    where("userId", "==", userRef(db, userId)),
  )
  const { set, update } = useFirestoreMutation()
  const [newTagId, setNewTagId] = useState("")

  // ADR-0025: tag operations surface a German confirmation toast on
  // success and an error toast + telemetry on failure.
  const addTagMutation = useAsyncMutation({
    context: "admin.userAddTag",
    successMessage: "Tag hinzugefügt",
    errorMessage: "Tag konnte nicht hinzugefügt werden",
  })
  const toggleTagMutation = useAsyncMutation({
    context: "admin.userToggleTag",
    successMessage: "Tag-Status aktualisiert",
    errorMessage: "Tag-Status konnte nicht geändert werden",
  })
  // Web NFC scan (Chrome/Android). The hook reads the tag's SUN URL and
  // resolves the real UID server-side (tags use Random-ID).
  const { supported: nfcSupported, scanTag } = useTagScan()
  const scanTagMutation = useAsyncMutation<ResolveTagResult>({
    context: "admin.userScanTag",
    errorMessage: "Tag konnte nicht gelesen werden",
  })

  const handleAddTag = async () => {
    if (!newTagId.trim()) return
    try {
      await addTagMutation.mutate(() =>
        set(tokenRef(db, newTagId.trim()), {
          userId: userRef(db, userId),
          label: "",
          registered: serverTimestamp(),
        } as unknown as TokenDoc),
      )
      setNewTagId("")
    } catch {
      // Keep `newTagId` so the admin can edit + retry without re-typing.
    }
  }

  const handleScanTag = async () => {
    let result
    try {
      result = await scanTagMutation.mutate(() => scanTag())
    } catch {
      return
    }
    // Already registered → don't silently reassign; tell the admin where
    // it lives. If it's this person's own tag, just confirm.
    if (result.registered && result.userId) {
      const deact = result.deactivated ? " (deaktiviert)" : ""
      if (result.userId === userId) {
        toast.info(`Dieser Tag ist bereits dieser Person zugeordnet${deact}.`)
      } else {
        toast.warning(
          `Tag ist bereits ${result.userName ?? "einer anderen Person"} zugeordnet${deact}.`,
        )
      }
      return
    }
    setNewTagId(result.tokenId)
    toast.success("Tag gelesen — UID übernommen. Bitte „Tag hinzufügen“ wählen.")
  }

  const handleToggleTag = async (tokenId: string, isDeactivated: boolean) => {
    try {
      await toggleTagMutation.mutate(() =>
        update(tokenRef(db, tokenId), {
          deactivated: isDeactivated
            ? null
            : (serverTimestamp() as unknown as null),
        }),
      )
    } catch {
      // Hook already toasted + reported telemetry.
    }
  }

  return (
    <Card className="mt-2 max-w-3xl">
      <CardContent className="space-y-4 pt-6">
        <div className="flex gap-2">
          {nfcSupported && (
            <Button
              variant="secondary"
              onClick={handleScanTag}
              disabled={scanTagMutation.loading}
            >
              {scanTagMutation.loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="mr-2 h-4 w-4" />
              )}
              Tag scannen
            </Button>
          )}
          <Input
            placeholder="Tag UID (hex, z.B. 04c339aa1e1890)"
            value={newTagId}
            onChange={(e) => setNewTagId(e.target.value)}
            className="max-w-xs"
          />
          <Button onClick={handleAddTag} disabled={!newTagId.trim()}>
            <Plus className="mr-2 h-4 w-4" />
            Tag hinzufügen
          </Button>
        </div>

        {loading ? (
          <PageLoading />
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Tags zugewiesen.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag UID</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Registriert</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => {
                const isDeactivated = !!token.deactivated
                return (
                  <TableRow key={token.id}>
                    <TableCell className="font-mono text-xs">{token.id}</TableCell>
                    <TableCell>{token.label || "–"}</TableCell>
                    <TableCell>{formatDateTime(token.registered)}</TableCell>
                    <TableCell>
                      {isDeactivated ? (
                        <Badge variant="destructive">Deaktiviert</Badge>
                      ) : (
                        <Badge variant="secondary">Aktiv</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleTag(token.id, isDeactivated)}
                      >
                        {isDeactivated ? (
                          <>
                            <RotateCcw className="mr-1 h-3 w-3" />
                            Aktivieren
                          </>
                        ) : (
                          <>
                            <Ban className="mr-1 h-3 w-3" />
                            Deaktivieren
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
