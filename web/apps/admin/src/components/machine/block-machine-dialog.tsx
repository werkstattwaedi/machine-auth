// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// "Sperren" dialog — blocking a machine picks a reason (Problem /
// Wartung) plus a note that terminals and the machine page show to
// members. Also used to edit the reason on an already-blocked machine.

import { useEffect, useState } from "react"
import { serverTimestamp } from "firebase/firestore"
import { machineRef } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { useAuth } from "@modules/lib/auth"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import type { MachineBlockedDoc } from "@modules/lib/firestore-entities"
import { Button } from "@modules/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Label } from "@modules/components/ui/label"
import { Textarea } from "@modules/components/ui/textarea"
import { Loader2, Lock } from "lucide-react"

export function BlockMachineDialog({
  open,
  onOpenChange,
  machineId,
  machineName,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  machineId: string
  machineName: string
  /** Current block when editing the reason; null when newly blocking. */
  existing: MachineBlockedDoc | null
}) {
  const db = useDb()
  const { userDoc } = useAuth()
  const { update, loading } = useFirestoreMutation()
  const [kind, setKind] = useState<MachineBlockedDoc["kind"]>("problem")
  const [note, setNote] = useState("")

  useEffect(() => {
    if (open) {
      setKind(existing?.kind ?? "problem")
      setNote(existing?.note ?? "")
    }
  }, [open, existing])

  const handleBlock = async () => {
    await update(
      machineRef(db, machineId),
      {
        blocked: {
          kind,
          note: note.trim() || null,
          byName: userDoc?.name ?? null,
          // Keep the original block time when only editing the reason.
          at: existing?.at ?? serverTimestamp(),
        } as unknown as MachineBlockedDoc,
      },
      {
        successMessage: existing
          ? "Sperrgrund aktualisiert"
          : `${machineName} gesperrt`,
      },
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Sperrgrund bearbeiten" : `${machineName} sperren`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Grund</Label>
          <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
            {(
              [
                ["problem", "Problem / Defekt"],
                ["maintenance", "Wartung"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors " +
                  (kind === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="block-note">Notiz</Label>
          <Textarea
            id="block-note"
            placeholder="z.B. Spindel macht Geräusche, bis Techniker geprüft hat nicht benutzen."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            variant={existing ? "default" : "destructive"}
            onClick={handleBlock}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Lock className="mr-2 h-4 w-4" />
            )}
            {existing ? "Speichern" : "Sperren"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
