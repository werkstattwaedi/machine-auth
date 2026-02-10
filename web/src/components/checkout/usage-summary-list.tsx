// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, formatCHF } from "@/lib/format"
import type { UsageMachineItem, UsageMaterialItem } from "./use-checkout-state"

interface UsageSummaryListProps {
  machineUsage: UsageMachineItem[]
  materialUsage: UsageMaterialItem[]
}

export function UsageSummaryList({
  machineUsage,
  materialUsage,
}: UsageSummaryListProps) {
  const hasMachine = machineUsage.length > 0
  const hasMaterial = materialUsage.length > 0

  if (!hasMachine && !hasMaterial) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Keine Nutzungsdaten vorhanden.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {hasMachine && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Maschinennutzung</CardTitle>
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
                    <TableCell className="text-sm">{u.machineName}</TableCell>
                    <TableCell className="text-sm">{u.workshop}</TableCell>
                    <TableCell className="text-sm">
                      {formatDateTime(u.checkIn)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {u.checkOut ? formatDateTime(u.checkOut) : "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {hasMaterial && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Materialnutzung</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Werkstatt</TableHead>
                  <TableHead>Menge</TableHead>
                  <TableHead className="text-right">Kosten</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialUsage.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-sm">{u.description}</TableCell>
                    <TableCell className="text-sm">{u.workshop}</TableCell>
                    <TableCell className="text-sm">
                      {u.quantity} {u.category}
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {formatCHF(u.totalPrice)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
