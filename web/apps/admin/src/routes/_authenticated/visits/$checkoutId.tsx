// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Opened Besuch (checkout) — the one place where line items get edited.
// Open visits: positions removable, whole visit deletable. Billed visits
// are read-only records with their summary and bill reference; an admin
// can void them ("Stornieren") or issue a corrected re-issue
// ("Korrigieren") — ADR-0042. Cancelled visits stay, marked as such, and
// link to their replacement.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useDocument, useCollection } from "@modules/lib/firestore"
import { useDb } from "@modules/lib/firebase-context"
import {
  catalogReferencesRef,
  checkoutItemRef,
  checkoutItemsCollection,
  checkoutRef,
} from "@modules/lib/firestore-helpers"
import { useFirestoreMutation } from "@modules/hooks/use-firestore-mutation"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import {
  formatBillReference,
  formatCHF,
  formatDateTime,
} from "@modules/lib/format"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@modules/components/ui/card"
import { ConfirmDialog } from "@modules/components/confirm-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { SummaryField } from "@/components/visit/summary-fields"
import { VisitStatusBadge } from "@/components/visit/visit-status-badge"
import { CancelVisitDialog } from "@/components/visit/cancel-visit-dialog"
import { correctionBlockedReason } from "@/lib/visit-correction"
import { Ban, Loader2, MoveRight, Pencil, Trash2, X } from "lucide-react"

export const Route = createFileRoute("/_authenticated/visits/$checkoutId")({
  component: VisitDetailPage,
})

function VisitDetailPage() {
  const db = useDb()
  const navigate = useNavigate()
  const { checkoutId } = Route.useParams()
  const { data: visit, loading } = useDocument(checkoutRef(db, checkoutId))
  const { data: items, loading: itemsLoading } = useCollection(
    checkoutItemsCollection(db, checkoutId),
  )
  // Correction context (ADR-0042): the bill decides whether the visit is
  // still correctable, the catalog references tell membership / badge
  // lines apart (those visits are excluded in v1), the linked checkouts
  // feed the banners.
  const { data: bill } = useDocument(visit?.billRef ?? null)
  const { data: sammelrechnung } = useDocument(bill?.aggregatedIntoBillRef ?? null)
  const { data: catalogRefs } = useDocument(catalogReferencesRef(db))
  const { data: original } = useDocument(visit?.supersedesCheckoutRef ?? null)
  const { users } = useLookup()
  const { remove } = useFirestoreMutation()
  const removeItemMutation = useAsyncMutation({
    context: "admin.visitRemoveItem",
    successMessage: "Position entfernt",
    errorMessage: "Position konnte nicht entfernt werden",
  })
  const deleteVisitMutation = useAsyncMutation({
    context: "admin.visitDelete",
    successMessage: "Besuch gelöscht",
    errorMessage: "Besuch konnte nicht gelöscht werden",
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  if (loading) return <PageLoading />
  if (!visit) return <div>Besuch nicht gefunden.</div>

  const isOpen = visit.status === "open"
  const isCancelled = visit.status === "cancelled"
  const personLabel = visit.persons?.length
    ? visit.persons.map((p) => p.name).join(", ")
    : visit.userId
      ? resolveRef(users, visit.userId)
      : "anonym"

  const itemsTotal = items.reduce((sum, it) => sum + (it.totalPrice ?? 0), 0)

  // Same guards as the server (ADR-0042); a missing references doc means
  // "no membership / badge SKU configured" — nothing to exclude.
  const correctable =
    correctionBlockedReason(
      visit,
      bill,
      items,
      {
        membershipCatalogId: catalogRefs?.membership?.id ?? null,
        badgeCatalogId: catalogRefs?.badge?.id ?? null,
      },
      sammelrechnung,
    ) === null
  const billReference = bill ? formatBillReference(bill.referenceNumber, bill.kind) : null
  const sammelReference =
    bill?.kind === "beleg" && sammelrechnung && !sammelrechnung.cancelledAt
      ? formatBillReference(sammelrechnung.referenceNumber, sammelrechnung.kind)
      : null

  const handleRemoveItem = async (itemId: string) => {
    try {
      await removeItemMutation.mutate(() =>
        remove(checkoutItemRef(db, checkoutId, itemId)),
      )
    } catch {
      // Hook already toasted + reported telemetry.
    }
  }

  const handleDeleteVisit = async () => {
    try {
      await deleteVisitMutation.mutate(async () => {
        // Items first so no orphaned subcollection docs linger.
        for (const item of items) {
          await remove(checkoutItemRef(db, checkoutId, item.id))
        }
        await remove(checkoutRef(db, checkoutId))
      })
    } catch {
      return
    }
    navigate({ to: "/visits" })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Besuch · ${personLabel}`}
        backTo="/visits"
        backLabel="Zurück zu Besuche"
        action={
          isOpen ? (
            <Button
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteVisitMutation.loading}
            >
              {deleteVisitMutation.loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Besuch löschen
            </Button>
          ) : correctable ? (
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link to="/visits/$checkoutId/correct" params={{ checkoutId }}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Korrigieren
                </Link>
              </Button>
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban className="mr-2 h-4 w-4" />
                Stornieren
              </Button>
            </div>
          ) : undefined
        }
      />

      {isCancelled && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          data-testid="visit-cancelled-banner"
        >
          <div className="font-medium text-destructive">
            Storniert am {formatDateTime(visit.cancelledAt)}
            {visit.cancelledBy
              ? ` durch ${users.get(visit.cancelledBy) ?? visit.cancelledBy}`
              : ""}
            {visit.cancellationReason ? ` · Grund: ${visit.cancellationReason}` : ""}
          </div>
          {visit.supersededByCheckoutRef && (
            <Link
              to="/visits/$checkoutId"
              params={{ checkoutId: visit.supersededByCheckoutRef.id }}
              className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Ersetzt durch korrigierten Besuch
              <MoveRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      {visit.supersedesCheckoutRef && (
        <div
          className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"
          data-testid="visit-replacement-banner"
        >
          <Link
            to="/visits/$checkoutId"
            params={{ checkoutId: visit.supersedesCheckoutRef.id }}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Korrektur des Besuchs vom {original ? formatDateTime(original.created) : "…"}
            <MoveRight className="h-3.5 w-3.5" />
          </Link>
          {bill?.correctionReason && (
            <div className="text-muted-foreground">Grund: {bill.correctionReason}</div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <VisitStatusBadge status={visit.status} />
        <Badge variant="outline">{visit.usageType}</Badge>
        <span className="text-muted-foreground">
          Beginn {formatDateTime(visit.created)}
          {visit.closedAt ? ` · abgeschlossen ${formatDateTime(visit.closedAt)}` : ""}
        </span>
        {visit.billRef && (
          <Link
            to="/invoices/$billId"
            params={{ billId: visit.billRef.id }}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Rechnung öffnen
            <MoveRight className="h-3.5 w-3.5" />
          </Link>
        )}
        {billReference && (
          <span className="font-mono text-xs text-muted-foreground">{billReference}</span>
        )}

      </div>

      {visit.userId && (
        <div className="text-sm">
          <Link
            to="/users/$userId"
            params={{ userId: visit.userId.id }}
            className="font-medium text-primary hover:underline"
          >
            {resolveRef(users, visit.userId)}
          </Link>
          {visit.workshopsVisited?.length ? (
            <span className="text-muted-foreground">
              {" "}
              · {visit.workshopsVisited.join(", ")}
            </span>
          ) : null}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Positionen ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {itemsLoading ? (
            <PageLoading />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Positionen.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bezeichnung</TableHead>
                  <TableHead>Werkstatt</TableHead>
                  <TableHead className="text-right">Menge</TableHead>
                  <TableHead className="text-right">Einzelpreis</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {isOpen && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.description}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.workshop}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCHF(item.unitPrice ?? 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCHF(item.totalPrice ?? 0)}
                    </TableCell>
                    {isOpen && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Position ${item.description} entfernen`}
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={removeItemMutation.loading}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-3 flex justify-end border-t pt-3 text-sm font-semibold tabular-nums">
            Summe {formatCHF(visit.summary?.totalPrice ?? itemsTotal)}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Besuch löschen?"
        description={`Der offene Besuch von ${personLabel} wird mit allen ${items.length} Positionen gelöscht.`}
        confirmLabel="Löschen"
        destructive
        onConfirm={handleDeleteVisit}
      />

      {billReference && (
        <CancelVisitDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          checkoutId={checkoutId}
          reference={billReference}
          sammelrechnungReference={sammelReference}
        />
      )}

      {visit.summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Abrechnung</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <SummaryField label="Nutzungsgebühren" value={visit.summary.entryFees} />
            <SummaryField label="Maschinen" value={visit.summary.machineCost} />
            <SummaryField label="Material" value={visit.summary.materialCost} />
            <SummaryField label="Trinkgeld" value={visit.summary.tip} />
            {visit.summary.discountAmount ? (
              <SummaryField
                label="Rabatt"
                value={-visit.summary.discountAmount}
              />
            ) : null}
            <SummaryField label="Total" value={visit.summary.totalPrice} bold />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
