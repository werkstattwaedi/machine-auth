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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import { USER_TYPE_LABELS, USAGE_TYPE_LABELS } from "@/lib/pricing"
import { ArrowLeft, Loader2, Send } from "lucide-react"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"

interface StepCheckoutProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  onSubmit: () => Promise<void>
  submitting: boolean
}

export function StepCheckout({
  state,
  dispatch,
  onSubmit,
  submitting,
}: StepCheckoutProps) {
  const personFees = state.persons.reduce((sum, p) => sum + p.fee, 0)
  const materialTotal = state.materialUsage.reduce(
    (sum, u) => sum + u.totalPrice,
    0
  )
  const total = personFees + materialTotal + state.tip

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Check Out</h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Zusammenfassung</CardTitle>
        </CardHeader>
        <CardContent>
          <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Nutzungsgebühren
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Nutzung</TableHead>
                <TableHead className="text-right">Gebühr</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.persons.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">
                    {p.firstName} {p.lastName}
                  </TableCell>
                  <TableCell className="text-sm">
                    {USER_TYPE_LABELS[p.userType]}
                  </TableCell>
                  <TableCell className="text-sm">
                    {USAGE_TYPE_LABELS[p.usageType]}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {formatCHF(p.fee)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {materialTotal > 0 && (
            <>
              <h3 className="text-xs font-medium text-muted-foreground mb-2 mt-4 uppercase tracking-wide">
                Materialkosten
              </h3>
              <div className="flex justify-between text-sm">
                <span>Material ({state.materialUsage.length} Posten)</span>
                <span>{formatCHF(materialTotal)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Trinkgeld / Spenden (CHF)</Label>
            <Input
              type="number"
              step="0.50"
              min="0"
              value={state.tip || ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_TIP",
                  amount: parseFloat(e.target.value) || 0,
                })
              }
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              Hast du bei uns einen tollen Tag erlebt? Wir freuen uns über
              jede Unterstützung!
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Total</div>
              <div className="text-2xl font-bold">{formatCHF(total)}</div>
              <div className="text-xs text-muted-foreground">keine MWST.</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Der Betrieb der Werkstatt basiert auf Vertrauen. Bitte gib deine
        Nutzung fair und ehrlich an.
      </p>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => dispatch({ type: "SET_STEP", step: 1 })}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück
        </Button>
        <Button
          className="flex-1"
          onClick={onSubmit}
          disabled={submitting || total < 0}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Senden & zur Kasse
        </Button>
      </div>
    </div>
  )
}
