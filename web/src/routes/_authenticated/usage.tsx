// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth, type UserDoc } from "@/lib/auth"
import { useCollection } from "@/lib/firestore"
import { where, orderBy } from "firebase/firestore"
import { userRef } from "@/lib/firestore-helpers"
import { formatDateTime, formatCHF } from "@/lib/format"
import { PageLoading } from "@/components/page-loading"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { History } from "lucide-react"

export const Route = createFileRoute("/_authenticated/usage")({
  component: UsagePage,
})

interface CheckoutDoc {
  time: { toDate(): Date }
  persons: { name: string; email: string; userType: string; usageType: string; fee: number }[]
  totalPrice: number
  tip: number
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
  const ref = userRef(userDoc.id)

  const { data: checkouts, loading } = useCollection<CheckoutDoc>(
    "checkouts",
    where("userId", "==", ref), orderBy("time", "desc")
  )

  if (loading) return <PageLoading />

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Nutzungsverlauf</h1>

      {checkouts.length === 0 ? (
        <EmptyState
          icon={History}
          title="Kein Nutzungsverlauf"
          description="Hier erscheinen deine vergangenen Checkouts."
        />
      ) : (
        <div className="space-y-4">
          {checkouts.map((co) => (
            <Card key={co.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    {formatDateTime(co.time)}
                  </CardTitle>
                  <Badge variant="secondary">{formatCHF(co.totalPrice)}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead className="text-right">Gebühr</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {co.persons.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{p.name}</TableCell>
                        <TableCell className="text-sm">{p.userType}</TableCell>
                        <TableCell className="text-sm text-right">
                          {formatCHF(p.fee)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {co.tip > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Trinkgeld: {formatCHF(co.tip)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
