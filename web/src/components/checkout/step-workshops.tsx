// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

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
    <div className="space-y-6">
      <h2 className="text-xl font-bold font-body">
        Kosten Werkstätten
      </h2>

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
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          onClick={() => dispatch({ type: "SET_STEP", step: 0 })}
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
          onClick={() => dispatch({ type: "SET_STEP", step: 2 })}
        >
          Check-Out
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
