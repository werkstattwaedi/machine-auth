// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth, type UserDoc } from "@modules/lib/auth"
import { useCollection } from "@modules/lib/firestore"
import { where, orderBy, type DocumentReference, type Timestamp } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { userRef } from "@modules/lib/firestore-helpers"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { formatDate, formatCHF } from "@modules/lib/format"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@modules/components/ui/table"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { History, FileText, Download, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

export const Route = createFileRoute("/_authenticated/usage")({
  component: UsagePage,
})

interface BillDoc {
  userId: DocumentReference
  checkouts: DocumentReference[]
  referenceNumber: number
  amount: number
  currency: string
  storagePath: string | null
  created: Timestamp
  paidAt: Timestamp | null
  paidVia: "twint" | "ebanking" | "cash" | null
}

interface CheckoutDoc {
  userId: DocumentReference
  status: string
  created: Timestamp
  closedAt?: Timestamp
  summary?: { totalPrice: number }
  billRef?: DocumentReference | null
}

const paidViaLabel: Record<string, string> = {
  twint: "TWINT",
  ebanking: "E-Banking",
  cash: "Bar",
}

function UsagePage() {
  const { userDoc, userDocLoading } = useAuth()

  if (userDocLoading) return <PageLoading />
  if (!userDoc) {
    return (
      <EmptyState
        icon={History}
        title="Konto nicht gefunden"
        description="Dein Benutzerkonto konnte nicht geladen werden. Bitte melde dich erneut an."
      />
    )
  }

  return <UsageContent userDoc={userDoc} />
}

function UsageContent({ userDoc }: { userDoc: UserDoc }) {
  const db = useDb()
  const ref = userRef(db, userDoc.id)

  const { data: bills, loading: billsLoading } = useCollection<BillDoc>(
    "bills",
    where("userId", "==", ref),
    orderBy("created", "desc"),
  )

  const { data: unbilledCheckouts, loading: checkoutsLoading } =
    useCollection<CheckoutDoc>(
      "checkouts",
      where("userId", "==", ref),
      where("status", "==", "closed"),
      where("billRef", "==", null),
      orderBy("closedAt", "desc"),
    )

  if (billsLoading || checkoutsLoading) return <PageLoading />

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Nutzungsverlauf</h1>

      {unbilledCheckouts.length > 0 && (
        <UnbilledCheckoutsSection checkouts={unbilledCheckouts} />
      )}
      <BillsSection bills={bills} />
    </div>
  )
}

function BillsSection({ bills }: { bills: (BillDoc & { id: string })[] }) {
  if (bills.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-3">Rechnungen</h2>
        <EmptyState
          icon={FileText}
          title="Keine Rechnungen"
          description="Hier erscheinen deine Rechnungen."
        />
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Rechnungen</h2>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nr.</TableHead>
              <TableHead>Datum</TableHead>
              <TableHead className="text-right">Betrag</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((bill) => (
              <TableRow key={bill.id}>
                <TableCell className="text-sm">{bill.referenceNumber}</TableCell>
                <TableCell className="text-sm">
                  {formatDate(bill.created)}
                </TableCell>
                <TableCell className="text-sm text-right">
                  {formatCHF(bill.amount)}
                </TableCell>
                <TableCell>
                  {bill.paidAt ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                      Bezahlt{bill.paidVia ? ` (${paidViaLabel[bill.paidVia] ?? bill.paidVia})` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Offen</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {bill.storagePath && <DownloadButton billId={bill.id} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function DownloadButton({ billId }: { billId: string }) {
  const functions = useFunctions()
  const [loading, setLoading] = useState(false)

  const handleDownload = async () => {
    setLoading(true)
    try {
      const getUrl = httpsCallable<{ billId: string }, { url: string }>(
        functions,
        "getInvoiceDownloadUrl",
      )
      const result = await getUrl({ billId })
      window.open(result.data.url, "_blank")
    } catch {
      toast.error("PDF konnte nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={handleDownload} disabled={loading} aria-label="PDF herunterladen">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
    </Button>
  )
}

function UnbilledCheckoutsSection({
  checkouts,
}: {
  checkouts: (CheckoutDoc & { id: string })[]
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Nicht verrechnete Checkouts</h2>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead className="text-right">Betrag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checkouts.map((co) => (
              <TableRow key={co.id}>
                <TableCell className="text-sm">
                  {formatDate(co.closedAt)}
                </TableCell>
                <TableCell className="text-sm text-right">
                  {formatCHF(co.summary?.totalPrice ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
