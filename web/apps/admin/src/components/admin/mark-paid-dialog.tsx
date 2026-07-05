// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// "Als bezahlt markieren" confirmation for one or more selected bills:
// pick the channel the money actually arrived on, then book via the
// admin-gated adminMarkBillsPaid callable (bills are client-write-denied).

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { rpcCallable } from "@modules/lib/rpc"
import { useFunctions } from "@modules/lib/firebase-context"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Label } from "@modules/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@modules/components/ui/select"
import { toast } from "sonner"

export type AdminPaidVia = "ebanking" | "twint" | "cash"

export interface MarkBillsPaidResult {
  paid: number
  alreadyPaid: string[]
  rejected: string[]
}

const PAID_VIA_LABELS: Record<AdminPaidVia, string> = {
  ebanking: "E-Banking / QR-Rechnung",
  twint: "TWINT",
  cash: "Bar",
}

export function MarkPaidDialog({
  open,
  onOpenChange,
  billIds,
  summary,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  billIds: string[]
  /** Selection summary shown in the dialog, e.g. "2 Rechnungen · CHF 144". */
  summary: string
  onDone?: () => void
}) {
  const functions = useFunctions()
  const [paidVia, setPaidVia] = useState<AdminPaidVia>("ebanking")
  const markPaid = useAsyncMutation<MarkBillsPaidResult>({
    context: "admin.markBillsPaid",
    errorMessage: "Rechnungen konnten nicht als bezahlt markiert werden",
  })

  const handleConfirm = async () => {
    let result: MarkBillsPaidResult
    try {
      result = await markPaid.mutate(async () => {
        const fn = rpcCallable<
          { bills: { billId: string; paidVia: AdminPaidVia }[] },
          MarkBillsPaidResult
        >(functions, "billingCall", "adminMarkBillsPaid")
        const res = await fn({
          bills: billIds.map((billId) => ({ billId, paidVia })),
        })
        return res.data
      })
    } catch {
      return
    }
    const skipped =
      result.alreadyPaid.length + result.rejected.length > 0
        ? ` · ${result.alreadyPaid.length + result.rejected.length} übersprungen`
        : ""
    toast.success(`${result.paid} als bezahlt markiert${skipped}.`)
    onOpenChange(false)
    onDone?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Als bezahlt markieren</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{summary}</p>
        <div className="space-y-2">
          <Label>Bezahlt via</Label>
          <Select
            value={paidVia}
            onValueChange={(v) => setPaidVia(v as AdminPaidVia)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PAID_VIA_LABELS) as AdminPaidVia[]).map((v) => (
                <SelectItem key={v} value={v}>
                  {PAID_VIA_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleConfirm} disabled={markPaid.loading}>
            {markPaid.loading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Als bezahlt markieren
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
