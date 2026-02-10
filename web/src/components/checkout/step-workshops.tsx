// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Button } from "@/components/ui/button"
import { UsageSummaryList } from "./usage-summary-list"
import { ArrowLeft, ArrowRight } from "lucide-react"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"

interface StepWorkshopsProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  isAnonymous: boolean
}

export function StepWorkshops({
  state,
  dispatch,
  isAnonymous,
}: StepWorkshopsProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Kosten Werkstätten</h2>

      {isAnonymous ? (
        <p className="text-sm text-muted-foreground">
          Werkstattkosten werden bei identifizierten Nutzer:innen automatisch
          aus Maschinen- und Materialnutzung berechnet.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Übersicht deiner Nutzungen seit dem letzten Checkout.
          </p>
          <UsageSummaryList
            machineUsage={state.machineUsage}
            materialUsage={state.materialUsage}
          />
        </>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => dispatch({ type: "SET_STEP", step: 0 })}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Zurück
        </Button>
        <Button
          className="flex-1"
          onClick={() => dispatch({ type: "SET_STEP", step: 2 })}
        >
          Weiter
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  )
}
