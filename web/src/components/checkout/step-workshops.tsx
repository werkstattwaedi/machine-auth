// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { formatDateTime } from "@/lib/format"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { getSortedWorkshops } from "@/lib/workshop-config"
import type { PricingConfig, WorkshopId } from "@/lib/workshop-config"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import {
  WorkshopInlineSection,
  type RawMaterialDoc,
  type ItemCallbacks,
} from "@/components/usage/inline-rows"

interface StepWorkshopsProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  isAnonymous: boolean
  config: PricingConfig | null
  rawMaterialUsage: RawMaterialDoc[]
}

export { type RawMaterialDoc }

export function StepWorkshops({
  state,
  dispatch,
  isAnonymous: _isAnonymous,
  config,
  rawMaterialUsage,
}: StepWorkshopsProps) {
  const sortedWorkshops = config ? getSortedWorkshops(config) : []

  const callbacks: ItemCallbacks = useMemo(
    () => ({
      addItem: (item) => dispatch({ type: "ADD_LOCAL_MATERIAL", item }),
      updateItem: (id, item) => dispatch({ type: "UPDATE_LOCAL_MATERIAL", id, item }),
      removeItem: (id) => dispatch({ type: "REMOVE_LOCAL_MATERIAL", id }),
    }),
    [dispatch],
  )

  // Pre-select workshops that already have items
  const [selectedWorkshops, setSelectedWorkshops] = useState<Set<WorkshopId>>(
    () => {
      const initial = new Set<WorkshopId>()
      for (const item of state.localMaterialUsage) {
        if (item.workshop) initial.add(item.workshop as WorkshopId)
      }
      for (const item of rawMaterialUsage) {
        if (item.workshop) initial.add(item.workshop as WorkshopId)
      }
      for (const item of state.machineUsage) {
        if (item.workshop) initial.add(item.workshop as WorkshopId)
      }
      return initial
    },
  )

  const toggleWorkshop = (wsId: WorkshopId) => {
    setSelectedWorkshops((prev) => {
      const next = new Set(prev)
      if (next.has(wsId)) {
        next.delete(wsId)
        // Remove all local items for this workshop
        state.localMaterialUsage
          .filter((i) => i.workshop === wsId)
          .forEach((i) =>
            dispatch({ type: "REMOVE_LOCAL_MATERIAL", id: i.id }),
          )
      } else {
        next.add(wsId)
      }
      return next
    })
  }

  return (
    <div className="space-y-8">
      {/* Workshop checkbox selector */}
      <div>
        <h2 className="text-xl font-bold font-body mb-2">
          Werkstätten wählen
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Für welche Werkstätten möchtest du Kosten erfassen?
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {sortedWorkshops.map(([wsId, ws]) => (
            <label key={wsId} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={selectedWorkshops.has(wsId)}
                onCheckedChange={() => toggleWorkshop(wsId)}
              />
              <span className="text-sm">{ws.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* NFC machine usage (always read-only) */}
      {state.machineUsage.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <h3 className="text-sm font-bold mb-2">Maschinennutzung (NFC)</h3>
            {state.machineUsage.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 py-1 text-sm border-b border-dashed last:border-0"
              >
                <span className="flex-1">
                  {u.machineName} ({u.workshop})
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(u.checkIn)}
                  {u.checkOut
                    ? ` – ${formatDateTime(u.checkOut)}`
                    : " (Aktiv)"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Per-workshop inline sections */}
      {config &&
        sortedWorkshops
          .filter(([wsId]) => selectedWorkshops.has(wsId))
          .map(([wsId, wsConfig]) => (
            <WorkshopInlineSection
              key={wsId}
              workshopId={wsId}
              workshop={wsConfig}
              config={config}
              localItems={state.localMaterialUsage.filter(
                (i) => i.workshop === wsId,
              )}
              existingItems={rawMaterialUsage.filter(
                (i) => i.workshop === wsId,
              )}
              callbacks={callbacks}
            />
          ))}

      {/* Navigation */}
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
