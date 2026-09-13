// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// "Stornieren" dialog (ADR-0042): voids a closed visit and its bill with a
// reason via the correctCheckouts callable. The checkout and bill stay in
// place as "storniert"; the customer gets the cancellation notice. When the
// bill is a Beleg inside a sent Sammelrechnung, that Sammelrechnung is
// re-issued immediately — the copy says so and points multi-Beleg fixes to
// the Sammelrechnung page, where one commit yields one revision.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { CorrectCheckoutsRequest, CorrectCheckoutsResult } from "@oww/shared"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Label } from "@modules/components/ui/label"
import { Textarea } from "@modules/components/ui/textarea"
import { serverMessage } from "@/lib/server-message"
import { validateReason } from "@/lib/visit-correction"
import { Ban, Loader2 } from "lucide-react"

export function CancelVisitDialog({
  open,
  onOpenChange,
  checkoutId,
  reference,
  sammelrechnungReference,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  checkoutId: string
  /** Display reference of the bill being voided, e.g. "RE-4200001". */
  reference: string
  /** Set when the bill is a Beleg inside a sent, unpaid Sammelrechnung. */
  sammelrechnungReference: string | null
}) {
  const functions = useFunctions()
  const [reason, setReason] = useState("")
  const [serverError, setServerError] = useState<string | null>(null)
  const cancel = useAsyncMutation<CorrectCheckoutsResult>({
    context: "admin.visitCancel",
    errorMessage: "Besuch konnte nicht storniert werden",
  })

  useEffect(() => {
    if (open) {
      setReason("")
      setServerError(null)
    }
  }, [open])

  const reasonError = validateReason(reason)

  const handleConfirm = async () => {
    setServerError(null)
    let result: CorrectCheckoutsResult
    try {
      result = await cancel.mutate(async () => {
        const fn = rpcCallable<CorrectCheckoutsRequest, CorrectCheckoutsResult>(
          functions,
          "billingCall",
          "correctCheckouts",
        )
        const res = await fn({ reason: reason.trim(), corrections: [{ checkoutId }] })
        return res.data
      })
    } catch (err) {
      // The hook toasted + reported; the server's German guard message
      // (failed-precondition) is the useful part — show it inline.
      setServerError(serverMessage(err, "Besuch konnte nicht storniert werden."))
      return
    }
    const revision = result.revisionBillId
      ? result.references[result.references.length - 1]
      : null
    toast.success(
      revision
        ? `${reference} storniert · Sammelrechnung als ${revision} neu ausgestellt`
        : `${reference} storniert`,
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{reference} stornieren</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Besuch und Rechnung bleiben als storniert sichtbar. Die Person
          erhält die Stornierungsmitteilung per E-Mail.
          {sammelrechnungReference
            ? ` Die Sammelrechnung ${sammelrechnungReference} wird sofort neu ausgestellt und versandt. Mehrere Belege dieser Sammelrechnung? Über die Sammelrechnung korrigieren.`
            : ""}
        </p>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Grund</Label>
          <Textarea
            id="cancel-reason"
            placeholder="z.B. Doppelt erfasst"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {reason.length > 0 && reasonError && (
            <p className="text-xs text-destructive">{reasonError}</p>
          )}
        </div>
        {serverError && (
          <p className="text-sm text-destructive" role="alert">
            {serverError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={cancel.loading || !!reasonError}
          >
            {cancel.loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Ban className="mr-2 h-4 w-4" />
            )}
            Stornieren
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
