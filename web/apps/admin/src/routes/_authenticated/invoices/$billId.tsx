// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Rechnung detail — the deep-link target from Besuche, person page and
// the list. Read-only bill facts (bills are server-written), PDF
// download, mark-paid for open invoices, links to the underlying visits.

import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { useDocument } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { billRef } from "@modules/lib/firestore-helpers"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { BillStatusBadge } from "@/components/admin/bill-status-badge"
import { MarkPaidDialog } from "@/components/admin/mark-paid-dialog"
import { billStatus } from "@/lib/bill-status"
import {
  formatBillReference,
  formatCHF,
  formatDateTime,
} from "@modules/lib/format"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { CheckCheck, Download, Loader2, MoveRight } from "lucide-react"

export const Route = createFileRoute("/_authenticated/invoices/$billId")({
  component: BillDetailPage,
})

const PAID_VIA_LABELS: Record<string, string> = {
  twint: "TWINT",
  ebanking: "E-Banking",
  cash: "Bar",
  free: "Gratis",
}

function BillDetailPage() {
  const db = useDb()
  const functions = useFunctions()
  const { billId } = Route.useParams()
  const { data: bill, loading } = useDocument(billRef(db, billId))
  const { users } = useLookup()
  const [markPaidOpen, setMarkPaidOpen] = useState(false)
  const download = useAsyncMutation<string>({
    context: "admin.billDownload",
    errorMessage: "PDF konnte nicht geladen werden",
  })

  if (loading) return <PageLoading />
  if (!bill) return <div>Rechnung nicht gefunden.</div>

  const reference = formatBillReference(bill.referenceNumber, bill.kind)
  const status = billStatus(bill, Date.now())
  const payable = status === "open" || status === "overdue"

  const handleDownload = async () => {
    let url: string
    try {
      url = await download.mutate(async () => {
        const fn = rpcCallable<{ billId: string }, { url: string }>(
          functions,
          "billingCall",
          "getInvoiceDownloadUrl",
        )
        const res = await fn({ billId })
        return res.data.url
      })
    } catch {
      return
    }
    // Anchor click instead of window.open — see price-list PDF download.
    const a = document.createElement("a")
    a.href = url
    a.rel = "noopener"
    a.target = "_self"
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={reference}
        backTo="/invoices"
        backLabel="Zurück zu Rechnungen"
        action={
          <div className="flex gap-2">
            {bill.storagePath && (
              <Button variant="outline" onClick={handleDownload} disabled={download.loading}>
                {download.loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                PDF
              </Button>
            )}
            {payable && (
              <Button onClick={() => setMarkPaidOpen(true)}>
                <CheckCheck className="mr-2 h-4 w-4" />
                Als bezahlt markieren
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm sm:grid-cols-3">
          <Field label="Status">
            <BillStatusBadge status={status} />
          </Field>
          <Field label="Betrag">
            <span className="font-heading text-lg font-bold tabular-nums">
              {formatCHF(bill.amount ?? 0)}
            </span>
          </Field>
          <Field label="Person">
            {bill.userId ? (
              <Link
                to="/users/$userId"
                params={{ userId: bill.userId.id }}
                className="font-medium text-primary hover:underline"
              >
                {resolveRef(users, bill.userId)}
              </Link>
            ) : (
              "–"
            )}
          </Field>
          <Field label="Erstellt">{formatDateTime(bill.created)}</Field>
          <Field label="Bezahlt">
            {bill.paidAt
              ? `${formatDateTime(bill.paidAt)}${
                  bill.paidVia ? ` · ${PAID_VIA_LABELS[bill.paidVia] ?? bill.paidVia}` : ""
                }`
              : "–"}
          </Field>
          <Field label="Herkunft">
            {bill.source === "membership-renewal"
              ? "Mitgliedschafts-Verlängerung"
              : "Besuch / Checkout"}
          </Field>
          {bill.aggregatedIntoBillRef && (
            <Field label="Verrechnet über">
              <Link
                to="/invoices/$billId"
                params={{ billId: bill.aggregatedIntoBillRef.id }}
                className="text-primary hover:underline"
              >
                Sammelrechnung öffnen
              </Link>
            </Field>
          )}
        </CardContent>
      </Card>

      {(bill.checkouts?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-3 text-sm font-semibold">
              Verrechnete Besuche ({bill.checkouts.length})
            </h2>
            <ul className="space-y-1.5 text-sm">
              {bill.checkouts.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/visits/$checkoutId"
                    params={{ checkoutId: c.id }}
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Besuch {c.id.slice(0, 8)}
                    <MoveRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <MarkPaidDialog
        open={markPaidOpen}
        onOpenChange={setMarkPaidOpen}
        billIds={[billId]}
        summary={`${reference} · ${formatCHF(bill.amount ?? 0)}`}
      />
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}
