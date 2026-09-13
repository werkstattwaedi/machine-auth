// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Batch correction of a Sammelrechnung's Belege (ADR-0041): one editor per
// active Beleg (collapsed until opened), one reason, one commit. Only the
// changed Belege go to the server, which voids them, mints their
// replacements and re-issues the Sammelrechnung as a single revision — so
// the member gets exactly one mail with the corrected Sammelrechnung and
// the changed Belege attached.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { where } from "firebase/firestore"
import { toast } from "sonner"
import type {
  CorrectCheckoutsRequest,
  CorrectCheckoutsResult,
  UserType,
} from "@oww/shared"
import type { BillDoc, CatalogReferencesDoc } from "@modules/lib/firestore-entities"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import {
  billRef,
  billsCollection,
  catalogReferencesRef,
  checkoutItemsCollection,
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
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent, CardHeader } from "@modules/components/ui/card"
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

export const Route = createFileRoute("/_authenticated/invoices/$billId_/correct")({
  component: CorrectSammelrechnungPage,
})

interface RowState {
  draft: CorrectionDraft
  original: CorrectionDraft
}

type FeeLookup = (userType: string) => number | null

function CorrectSammelrechnungPage() {
  const db = useDb()
  const functions = useFunctions()
  const navigate = useNavigate()
  const { billId } = Route.useParams()
  const { data: bill, loading } = useDocument(billRef(db, billId))
  const { data: belege, loading: belegeLoading } = useCollection(
    billsCollection(db),
    where("aggregatedIntoBillRef", "==", billRef(db, billId)),
  )
  const { data: catalogRefs } = useDocument(catalogReferencesRef(db))
  const pricing = usePricingConfig()
  // Keyed by checkout id — one row per active Beleg once its card loaded.
  const [rows, setRows] = useState<Map<string, RowState>>(new Map())
  const [reason, setReason] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const correct = useAsyncMutation<CorrectCheckoutsResult>({
    context: "admin.sammelrechnungCorrect",
    errorMessage: "Korrektur konnte nicht gespeichert werden",
  })

  if (loading || belegeLoading || pricing.loading) return <PageLoading />
  if (!bill) return <div>Rechnung nicht gefunden.</div>

  const reference = formatBillReference(bill.referenceNumber, bill.kind)
  const active = belege
    .filter((b) => !b.cancelledAt && (b.kind ?? "invoice") === "beleg")
    .sort((a, b) => a.referenceNumber - b.referenceNumber)
  const blocked =
    (bill.kind ?? "invoice") !== "invoice"
      ? "Nur eine Sammelrechnung kann hier korrigiert werden."
      : bill.cancelledAt
        ? "Die Sammelrechnung wurde bereits storniert."
        : bill.paidAt
          ? "Die Sammelrechnung ist bereits bezahlt — bezahlte Rechnungen können in dieser Version nicht korrigiert werden."
          : active.length === 0
            ? "Diese Sammelrechnung hat keine aktiven Belege."
            : null
  if (blocked) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={`Belege korrigieren · ${reference}`}
          backTo={`/invoices/${billId}`}
          backLabel="Zurück zur Rechnung"
        />
        <EmptyState icon={Ban} title="Sammelrechnung kann nicht korrigiert werden" description={blocked} />
      </div>
    )
  }

  const config = pricing.data
  const fee: FeeLookup = (ut) => standardFee(ut as UserType, config)
  const workshops = Object.keys(config?.workshops ?? {})
  const changed = [...rows.entries()].filter(([, r]) => !isUnchanged(r.draft, r.original))
  const errors = changed.flatMap(([, r]) => validateDraft(r.draft))
  const reasonError = validateReason(reason)
  let newTotal = 0
  let estimateMissing = false
  for (const beleg of active) {
    const checkoutId = beleg.checkouts[0]?.id
    const row = checkoutId ? rows.get(checkoutId) : undefined
    if (row && !isUnchanged(row.draft, row.original)) {
      const estimate = estimateSummary(row.draft, fee)
      if (estimate) newTotal += estimate.totalPrice
      else estimateMissing = true
    } else {
      newTotal += beleg.amount
    }
  }
  const nextReference = formatBillReference(bill.referenceNumber + 1, bill.kind)
  const canSubmit = changed.length > 0 && errors.length === 0 && !reasonError && !correct.loading

  const upsertRow = (checkoutId: string, update: (prev: RowState | undefined) => RowState) =>
    setRows((prev) => {
      const next = new Map(prev)
      next.set(checkoutId, update(prev.get(checkoutId)))
      return next
    })

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
          corrections: changed.map(([checkoutId, r]) => toWireEntry(checkoutId, r.draft)),
        })
        return res.data
      })
    } catch (err) {
      setServerError(serverMessage(err, "Korrektur konnte nicht gespeichert werden."))
      return
    }
    const revision = result.references[result.references.length - 1]
    toast.success(`${changed.length} Beleg(e) korrigiert · Sammelrechnung neu ausgestellt als ${revision}`)
    navigate({ to: "/invoices/$billId", params: { billId: result.revisionBillId ?? billId } })
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={`Belege korrigieren · ${reference}`}
        backTo={`/invoices/${billId}`}
        backLabel="Zurück zur Rechnung"
      />
      <p className="text-sm text-muted-foreground">
        {active.length} Belege · bisher {formatCHF(bill.amount)}. Geänderte Belege werden storniert
        und neu ausgestellt; die Sammelrechnung wird in einem Schritt als {nextReference} neu
        ausgestellt — eine E-Mail für alles.
      </p>

      {active.map((beleg) => (
        <BelegCorrectionCard
          key={beleg.id}
          beleg={beleg}
          workshops={workshops}
          fee={fee}
          catalogRefs={catalogRefs}
          state={rows.get(beleg.checkouts[0]?.id ?? "")}
          onInit={(checkoutId, original) =>
            upsertRow(checkoutId, () => ({ draft: original, original }))
          }
          onChange={(checkoutId, draft) =>
            upsertRow(checkoutId, (prev) => ({ draft, original: prev?.original ?? draft }))
          }
          disabled={correct.loading}
        />
      ))}

      {errors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {errors.map((e, i) => (
            <li key={`${i}-${e}`}>{e}</li>
          ))}
        </ul>
      )}
      {serverError && (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      )}

      <div className="sticky bottom-0 border-t bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm">
            <SummaryField label="Sammelrechnung" value={newTotal} previous={bill.amount} bold />
            {estimateMissing && (
              <p className="text-xs text-destructive">
                {pricing.configError ?? "Preise konnten nicht geladen werden."}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {changed.length} von {active.length} Belegen geändert · Verbindlich berechnet der Server.
            </p>
          </div>
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="sammel-reason">Grund der Korrektur</Label>
            <Textarea
              id="sammel-reason"
              rows={2}
              placeholder="z.B. Materialmengen im Juli falsch erfasst"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={correct.loading}
            />
            {reason.length > 0 && reasonError && (
              <p className="text-xs text-destructive">{reasonError}</p>
            )}
          </div>
          <Button variant="outline" asChild>
            <Link to="/invoices/$billId" params={{ billId }}>
              Abbrechen
            </Link>
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!canSubmit}>
            {correct.loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="mr-2 h-4 w-4" />
            )}
            Sammelrechnung neu ausstellen
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sammelrechnung neu ausstellen?"
        description={`${changed.length} Beleg(e) werden korrigiert, ${reference} wird storniert und als ${nextReference} über ${formatCHF(newTotal)} neu ausgestellt (bisher ${formatCHF(bill.amount)}). Die Person erhält eine E-Mail mit der korrigierten Sammelrechnung und den geänderten Belegen.`}
        confirmLabel="Neu ausstellen"
        destructive
        onConfirm={handleSubmit}
      />
    </div>
  )
}

function BelegCorrectionCard({
  beleg,
  workshops,
  fee,
  catalogRefs,
  state,
  onInit,
  onChange,
  disabled,
}: {
  beleg: BillDoc & { id: string }
  workshops: string[]
  fee: FeeLookup
  catalogRefs: (CatalogReferencesDoc & { id: string }) | null
  state: RowState | undefined
  onInit: (checkoutId: string, original: CorrectionDraft) => void
  onChange: (checkoutId: string, draft: CorrectionDraft) => void
  disabled: boolean
}) {
  const db = useDb()
  const checkoutDocRef = beleg.checkouts[0] ?? null
  const { data: checkout, loading } = useDocument(checkoutDocRef)
  const { data: items, loading: itemsLoading } = useCollection(
    checkoutDocRef ? checkoutItemsCollection(db, checkoutDocRef.id) : null,
  )
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (state || !checkoutDocRef || !checkout || itemsLoading) return
    onInit(checkoutDocRef.id, draftFromCheckout(checkout, items))
  }, [state, checkoutDocRef, checkout, items, itemsLoading, onInit])

  if (!checkoutDocRef) return null
  const reference = formatBillReference(beleg.referenceNumber, beleg.kind)
  const blocked = checkout
    ? correctionBlockedReason(checkout, beleg, items, {
        membershipCatalogId: catalogRefs?.membership?.id ?? null,
        badgeCatalogId: catalogRefs?.badge?.id ?? null,
      })
    : null
  const dirty = state ? !isUnchanged(state.draft, state.original) : false
  const estimate = state && dirty ? estimateSummary(state.draft, fee) : null

  return (
    <Card data-testid={`beleg-card-${beleg.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs">{reference}</span>
          {checkout && (
            <span className="text-muted-foreground">{formatDateTime(checkout.created)}</span>
          )}
          <span className="tabular-nums">{formatCHF(beleg.amount)}</span>
          {dirty && estimate && (
            <span className="tabular-nums">→ {formatCHF(estimate.totalPrice)}</span>
          )}
          {dirty && (
            <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
              geändert
            </Badge>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          disabled={!!blocked}
          aria-expanded={open}
          aria-label={`${reference} ${open ? "schliessen" : "bearbeiten"}`}
        >
          {open ? "Schliessen" : "Bearbeiten"}
        </Button>
      </CardHeader>
      {blocked && (
        <CardContent className="text-sm text-muted-foreground">{blocked}</CardContent>
      )}
      {open && !blocked && (
        <CardContent>
          {loading || itemsLoading || !state ? (
            <PageLoading />
          ) : (
            <CorrectVisitEditor
              draft={state.draft}
              onChange={(d) => onChange(checkoutDocRef.id, d)}
              workshops={workshops}
              disabled={disabled}
              idPrefix={`beleg-${beleg.id}`}
            />
          )}
        </CardContent>
      )}
    </Card>
  )
}
