// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Kontoauszug abgleichen — upload a camt.053 bank export, match the QR
// (SCOR) references against open invoices, review, then book all matched
// payments in one step. Unmatched payments stay listed for manual
// handling. TWINT exports are not supported yet (no stable format).

import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { orderBy, limit } from "firebase/firestore"
import { useCollection } from "@modules/lib/firestore"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { billsCollection } from "@modules/lib/firestore-helpers"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { BulkBar } from "@/components/admin/bulk-bar"
import { StatCards } from "@/components/admin/stat-cards"
import type { MarkBillsPaidResult } from "@/components/admin/mark-paid-dialog"
import {
  matchStatement,
  parseCamt053,
  type MatchResult,
  type ParsedStatement,
} from "@/lib/camt"
import {
  formatBillReference,
  formatCHF,
  formatDate,
} from "@modules/lib/format"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card } from "@modules/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { Timestamp } from "firebase/firestore"
import { AlertTriangle, CheckCheck, FileUp, Loader2 } from "lucide-react"
import { toast } from "sonner"

export const Route = createFileRoute("/_authenticated/invoices/import")({
  component: StatementImportPage,
})

function StatementImportPage() {
  const db = useDb()
  const functions = useFunctions()
  const { users } = useLookup()
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedStatement | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [booked, setBooked] = useState(false)

  // Match against the full recent bill window. Reference numbers are
  // sequential, so anything older than the last 1000 bills is long paid.
  const { data: bills, loading } = useCollection(
    billsCollection(db),
    orderBy("created", "desc"),
    limit(1000),
  )

  const book = useAsyncMutation<MarkBillsPaidResult>({
    context: "admin.statementImportBook",
    errorMessage: "Zahlungen konnten nicht gebucht werden",
  })

  const result: MatchResult | null = useMemo(() => {
    if (!parsed) return null
    return matchStatement(
      parsed.entries,
      bills.map((b) => ({
        id: b.id,
        referenceNumber: b.referenceNumber,
        amount: b.amount ?? 0,
        paid: !!b.paidAt,
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, bills])

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setParseError(null)
    setParsed(null)
    setBooked(false)
    try {
      const text = await file.text()
      setParsed(parseCamt053(text))
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleBook = async () => {
    if (!result || result.matched.length === 0) return
    let res: MarkBillsPaidResult
    try {
      res = await book.mutate(async () => {
        const fn = rpcCallable<
          {
            bills: {
              billId: string
              paidVia: "ebanking"
              paidAtMs?: number
            }[]
          },
          MarkBillsPaidResult
        >(functions, "billingCall", "adminMarkBillsPaid")
        const out = await fn({
          bills: result.matched.map((m) => ({
            billId: m.bill.id,
            paidVia: "ebanking",
            paidAtMs: m.entry.bookingDateMs ?? undefined,
          })),
        })
        return out.data
      })
    } catch {
      return
    }
    setBooked(true)
    toast.success(`${res.paid} Zahlungen gebucht.`)
  }

  if (loading) return <PageLoading />

  const bookableAmount =
    result?.matched.reduce((s, m) => s + m.entry.amount, 0) ?? 0

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title="Kontoauszug abgleichen"
        backTo="/invoices"
        backLabel="Zurück zu Rechnungen"
      />

      <Card className="p-4">
        <label className="flex items-center gap-3">
          <Button asChild variant="outline">
            <span>
              <FileUp className="mr-2 h-4 w-4" />
              camt.053 auswählen
            </span>
          </Button>
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <span className="text-sm text-muted-foreground">
            {fileName ?? "Keine Datei gewählt"}
            {parsed &&
              ` · ${parsed.entries.length} Gutschriften erkannt` +
                (parsed.toDateMs
                  ? ` · bis ${formatDate(Timestamp.fromMillis(parsed.toDateMs))}`
                  : "")}
          </span>
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          Bank-Export im camt.053-Format (XML). TWINT-Exporte werden noch
          nicht unterstützt — TWINT-Zahlungen in der Liste manuell als
          bezahlt markieren.
        </p>
      </Card>

      {parseError && (
        <Card className="border-destructive p-4 text-sm text-destructive">
          {parseError}
        </Card>
      )}

      {result && (
        <>
          <StatCards
            cards={[
              {
                label: "Zugeordnet",
                value: result.matched.length,
                tone: "text-cog-teal-dark",
              },
              {
                label: "Nicht zuordenbar",
                value: result.unmatched.length,
                tone: result.unmatched.length ? "text-destructive" : undefined,
              },
              { label: "Bereits bezahlt", value: result.alreadyPaid.length },
            ]}
          />

          {result.matched.length > 0 && !booked && (
            <BulkBar
              label={`${result.matched.length} zugeordnet · ${formatCHF(bookableAmount)}`}
            >
              <Button size="sm" onClick={handleBook} disabled={book.loading}>
                {book.loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCheck className="mr-2 h-4 w-4" />
                )}
                Zahlungen buchen
              </Button>
            </BulkBar>
          )}

          {(result.matched.length > 0 || result.alreadyPaid.length > 0) && (
            <Card className="px-4 py-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rechnung</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Valuta</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                    <TableHead>Abgleich</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...result.matched, ...result.alreadyPaid].map((m, i) => {
                    const bill = bills.find((b) => b.id === m.bill.id)
                    const alreadyPaid = m.bill.paid
                    return (
                      <TableRow key={`${m.bill.id}-${i}`}>
                        <TableCell className="font-mono text-xs">
                          {bill
                            ? formatBillReference(bill.referenceNumber, bill.kind)
                            : m.bill.id}
                        </TableCell>
                        <TableCell>
                          {bill?.userId
                            ? resolveRef(users, bill.userId)
                            : (m.entry.debtorName ?? "–")}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {m.entry.bookingDateMs
                            ? formatDate(Timestamp.fromMillis(m.entry.bookingDateMs))
                            : "–"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCHF(m.entry.amount)}
                          {m.amountMismatch && (
                            <span
                              className="ml-1.5 inline-flex items-center text-oww-gold-dark"
                              title={`Rechnungsbetrag ${formatCHF(m.bill.amount)}`}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {alreadyPaid ? (
                            <Badge variant="outline">bereits bezahlt</Badge>
                          ) : booked ? (
                            <Badge variant="secondary">gebucht</Badge>
                          ) : (
                            <Badge className="bg-cog-teal-light text-cog-teal-dark border-cog-teal/30">
                              match
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {result.unmatched.length > 0 && (
            <Card className="px-4 py-2">
              <h3 className="px-2 pt-3 text-sm font-semibold">
                Nicht zuordenbare Zahlungen — manuell prüfen
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Einzahler</TableHead>
                    <TableHead>Valuta</TableHead>
                    <TableHead>Referenz</TableHead>
                    <TableHead className="text-right">Betrag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.unmatched.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell>{e.debtorName ?? "–"}</TableCell>
                      <TableCell className="tabular-nums">
                        {e.bookingDateMs
                          ? formatDate(Timestamp.fromMillis(e.bookingDateMs))
                          : "–"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.reference ?? "— fehlt —"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCHF(e.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
