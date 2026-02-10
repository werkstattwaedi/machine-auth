// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useAuth, type UserDoc } from "@/lib/auth"
import { useCollection } from "@/lib/firestore"
import { where } from "firebase/firestore"
import { userRef } from "@/lib/firestore-helpers"
import { formatDateTime, formatCHF } from "@/lib/format"
import { PageLoading } from "@/components/page-loading"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ShoppingCart, Coffee } from "lucide-react"

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
})

interface UsageMachineDoc {
  machine: { id: string }
  checkIn: { toDate(): Date }
  checkOut?: { toDate(): Date } | null
  checkout?: { id: string } | null
  workshop?: string
}

interface UsageMaterialDoc {
  description: string
  details?: { totalPrice?: number; category?: string; quantity?: number }
  created: { toDate(): Date }
  checkout?: { id: string } | null
  workshop?: string
}

function DashboardPage() {
  const { userDoc, userDocLoading } = useAuth()

  if (userDocLoading) return <PageLoading />
  if (!userDoc) {
    return (
      <EmptyState
        icon={Coffee}
        title="Konto nicht gefunden"
        description="Dein Benutzerkonto konnte nicht geladen werden. Bitte melde dich erneut an."
      />
    )
  }

  return <DashboardContent userDoc={userDoc} />
}

function DashboardContent({ userDoc }: { userDoc: UserDoc }) {
  const ref = userRef(userDoc.id)

  // Unchecked-out machine usage (checkout == null)
  const { data: machineUsage, loading: loadingMachine } = useCollection<UsageMachineDoc>(
    "usage_machine",
    where("userId", "==", ref), where("checkout", "==", null)
  )

  // Unchecked-out material usage (checkout == null)
  const { data: materialUsage, loading: loadingMaterial } = useCollection<UsageMaterialDoc>(
    "usage_material",
    where("userId", "==", ref), where("checkout", "==", null)
  )

  if (loadingMachine || loadingMaterial) return <PageLoading />

  const hasUsage = machineUsage.length > 0 || materialUsage.length > 0
  const materialTotal = materialUsage.reduce(
    (sum, u) => sum + (u.details?.totalPrice ?? 0),
    0
  )

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        Hallo, {userDoc.displayName || userDoc.name}
      </h1>

      {!hasUsage ? (
        <EmptyState
          icon={Coffee}
          title="Kein aktiver Besuch"
          description="Sobald du eine Maschine nutzt oder Material scannst, erscheinen deine Nutzungen hier."
        />
      ) : (
        <>
          {machineUsage.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Maschinennutzung</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Maschine</TableHead>
                      <TableHead>Werkstatt</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {machineUsage.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.machine?.id ?? "–"}</TableCell>
                        <TableCell>{u.workshop ?? "–"}</TableCell>
                        <TableCell>{formatDateTime(u.checkIn)}</TableCell>
                        <TableCell>
                          {u.checkOut ? formatDateTime(u.checkOut) : (
                            <span className="text-green-600 font-medium">Aktiv</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {materialUsage.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Materialnutzung</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Werkstatt</TableHead>
                      <TableHead>Menge</TableHead>
                      <TableHead>Kosten</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {materialUsage.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.description}</TableCell>
                        <TableCell>{u.workshop ?? "–"}</TableCell>
                        <TableCell>
                          {u.details?.quantity ?? "–"} {u.details?.category ?? ""}
                        </TableCell>
                        <TableCell>
                          {u.details?.totalPrice != null
                            ? formatCHF(u.details.totalPrice)
                            : "–"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Materialkosten (laufend)
                  </div>
                  <div className="text-xl font-bold">{formatCHF(materialTotal)}</div>
                </div>
                <Link to="/checkout">
                  <Button>
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    Zum Checkout
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
