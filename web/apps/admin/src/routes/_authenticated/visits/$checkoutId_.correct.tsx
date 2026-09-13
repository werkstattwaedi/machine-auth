// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Korrektur-Editor for one Besuch (ADR-0041): edit the draft, give one
// reason, commit once → the server voids the original and mints the
// replacement (and, for a Beleg inside a sent Sammelrechnung, that
// Sammelrechnung's revision — several Belege of one Sammelrechnung are
// better fixed from its own page in one commit). The estimate is
// client-side through the shared arithmetic; the server prices
// authoritatively. The `_` in the file name keeps this route outside
// `$checkoutId.tsx`, which renders no <Outlet/>.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type {
  CorrectCheckoutsRequest,
  CorrectCheckoutsResult,
  UserType,
} from "@oww/shared"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import {
  catalogReferencesRef,
  checkoutItemsCollection,
  checkoutRef,
} from "@modules/lib/firestore-helpers"
import { usePricingConfig } from "@modules/lib/workshop-config"
import { standardFee } from "@modules/lib/pricing"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { ConfirmDialog } from "@modules/components/confirm-dialog"
import { PageHeader } from "@/components/admin/page-header"
import {
  formatBillReference,
  formatCHF,
  formatDateTime,
} from "@modules/lib/format"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@modules/components/ui/card"
import { Label } from "@modules/components/ui/label"
import { Textarea } from "@modules/components/ui/textarea"
import { CorrectVisitEditor } from "@/components/visit/correct-visit-editor"
import { SummaryField } from "@/components/visit/summary-fields"
import { serverMessage } from "@/lib/server-message"
import {
  correctionBlockedReason,
  draftFromCheckout,
  estimateSummary,
  isUnchanged,
  toWireEntry,
  validateDraft,
  validateReason,
  type CorrectionDraft,
} from "@/lib/visit-correction"
import { Ban, Loader2, Pencil } from "lucide-react"

export const Route = createFileRoute("/_authenticated/visits/$checkoutId_/correct")({
  component: CorrectVisitPage,
})

function CorrectVisitPage() {
  const db = useDb()
  const functions = useFunctions()
  const navigate = useNavigate()
  const { checkoutId } = Route.useParams()
  const { data: visit, loading } = useDocument(checkoutRef(db, checkoutId))
  const { data: items, loading: itemsLoading } = useCollection(
    checkoutItemsCollection(db, checkoutId),
  )
  const { data: bill, loading: billLoading } = useDocument(visit?.billRef ?? null)
  const { data: sammelrechnung } = useDocument(bill?.aggregatedIntoBillRef ?? null)
  const { data: catalogRefs } = useDocument(catalogReferencesRef(db))
  const pricing = usePricingConfig()
  const [draft, setDraft] = useState<CorrectionDraft | null>(null)
  const [original, setOriginal] = useState<CorrectionDraft | null>(null)
  const [reason, setReason] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const correct = useAsyncMutation<CorrectCheckoutsResult>({
    context: "admin.visitCorrect",
    errorMessage: "Korrektur konnte nicht gespeichert werden",
  })

  // Initialise the draft once the visit and its items have settled; later
  // snapshot updates must not clobber the admin's edits.
  useEffect(() => {
    if (draft || !visit || itemsLoading) return
    const initial = draftFromCheckout(visit, items)
    setDraft(initial)
    setOriginal(initial)
  }, [draft, visit, items, itemsLoading])

  if (loading) return <PageLoading />
  if (!visit) return <div>Besuch nicht gefunden.</div>
  if (itemsLoading || billLoading || pricing.loading || !draft || !original) {
    return <PageLoading />
  }

  const blocked = correctionBlockedReason(visit, bill, items, {
    membershipCatalogId: catalogRefs?.membership?.id ?? null,
    badgeCatalogId: catalogRefs?.badge?.id ?? null,
  })
  if (blocked || !bill) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Korrektur"
          backTo={`/visits/${checkoutId}`}
          backLabel="Zurück zum Besuch"
        />
        <EmptyState
          icon={Ban}
          title="Besuch kann nicht korrigiert werden"
          description={blocked ?? "Zu diesem Besuch gibt es keine Rechnung."}
        />
      </div>
    )
  }

  const reference = formatBillReference(bill.referenceNumber, bill.kind)
  const nextReference = formatBillReference(bill.referenceNumber + 1, bill.kind)
  const sammelReference =
    bill.kind === "beleg" && sammelrechnung && !sammelrechnung.cancelledAt
      ? formatBillReference(sammelrechnung.referenceNumber, sammelrechnung.kind)
      : null
  const errors = validateDraft(draft)
  const unchanged = isUnchanged(draft, original)
  const reasonError = validateReason(reason)
  const config = pricing.data
  const estimate = estimateSummary(draft, (ut) => standardFee(ut as UserType, config))
  const workshops = Object.keys(config?.workshops ?? {})
  const canSubmit = errors.length === 0 && !unchanged && !reasonError && !correct.loading

  const handleSubmit = async () => {
    setServerError(null)
    let result: CorrectCheckoutsResult
    try {
      result = await correct.mutate(async () => {
        const fn = rpcCallable<CorrectCheckoutsRequest, CorrectCheckoutsResult>(
          functions,
          "billingCall",
          "correctCheckouts",
        )
        const res = await fn({
          reason: reason.trim(),
          corrections: [toWireEntry(checkoutId, draft)],
        })
        return res.data
      })
    } catch (err) {
      setServerError(serverMessage(err, "Korrektur konnte nicht gespeichert werden."))
      return
    }
    toast.success(`${reference} storniert · neu ausgestellt als ${result.references[0]}`)
    const replacementId = result.replacementCheckoutIds[0]
    if (replacementId) {
      navigate({ to: "/visits/$checkoutId", params: { checkoutId: replacementId } })
    } else {
      navigate({ to: "/visits" })
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={`Korrektur ${reference}`}
        backTo={`/visits/${checkoutId}`}
        backLabel="Zurück zum Besuch"
      />
      <p className="text-sm text-muted-foreground">
        Besuch vom {formatDateTime(visit.created)} · bisher {formatCHF(bill.amount)}. Die
        Originalrechnung wird storniert und als {nextReference} neu ausgestellt.
      </p>

      <Card>
        <CardContent className="pt-6">
          <CorrectVisitEditor
            draft={draft}
            onChange={setDraft}
            workshops={workshops}
            disabled={correct.loading}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Neue Abrechnung (Schätzung)</CardTitle>
        </CardHeader>
        <CardContent>
          {estimate ? (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <SummaryField
                label="Nutzungsgebühren"
                value={estimate.entryFees}
                previous={visit.summary?.entryFees}
              />
              <SummaryField
                label="Maschinen"
                value={estimate.machineCost}
                previous={visit.summary?.machineCost}
              />
              <SummaryField
                label="Material"
                value={estimate.materialCost}
                previous={visit.summary?.materialCost}
              />
              <SummaryField label="Trinkgeld" value={estimate.tip} previous={visit.summary?.tip} />
              {estimate.discountAmount || visit.summary?.discountAmount ? (
                <SummaryField
                  label="Rabatt"
                  value={-estimate.discountAmount}
                  previous={-(visit.summary?.discountAmount ?? 0)}
                />
              ) : null}
              <SummaryField label="Total" value={estimate.totalPrice} previous={bill.amount} bold />
            </div>
          ) : (
            <p className="text-sm text-destructive">
              {pricing.configError ?? "Preise konnten nicht geladen werden."}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Verbindlich berechnet der Server.</p>
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {unchanged && (
        <p className="text-sm text-muted-foreground">
          Noch nichts geändert — zum blossen Stornieren den Besuch öffnen und «Stornieren» wählen.
        </p>
      )}
      {serverError && (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      )}

      <div className="sticky bottom-0 border-t bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="correction-reason">Grund der Korrektur</Label>
            <Textarea
              id="correction-reason"
              rows={2}
              placeholder="z.B. Menge Ahorn falsch erfasst"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={correct.loading}
            />
            {reason.length > 0 && reasonError && (
              <p className="text-xs text-destructive">{reasonError}</p>
            )}
          </div>
          <Button variant="outline" asChild>
            <Link to="/visits/$checkoutId" params={{ checkoutId }}>
              Abbrechen
            </Link>
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!canSubmit}>
            {correct.loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="mr-2 h-4 w-4" />
            )}
            Stornieren und neu ausstellen
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Rechnung korrigieren?"
        description={
          `${reference} wird storniert und als ${nextReference} über ${
            estimate ? formatCHF(estimate.totalPrice) : "…"
          } neu ausgestellt (bisher ${formatCHF(bill.amount)}). Die Person erhält die Korrektur sofort per E-Mail.` +
          (sammelReference
            ? ` Die Sammelrechnung ${sammelReference} wird sofort neu ausgestellt und versandt. Mehrere Belege dieser Sammelrechnung? Über die Sammelrechnung korrigieren.`
            : "")
        }
        confirmLabel="Stornieren und neu ausstellen"
        destructive
        onConfirm={handleSubmit}
      />
    </div>
  )
}
