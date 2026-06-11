// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCatalogForWorkshop } from "@modules/lib/workshop-config"
import type { WorkshopId } from "@modules/lib/workshop-config"
import { MaterialPicker } from "@/components/usage/material-picker"
import { restorePickerScrollAnchor } from "@/components/usage/picker-scroll-anchor"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { useBounceIfNoCheckout } from "@/components/checkout/use-bounce-if-no-checkout"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"

export const Route = createFileRoute(
  "/_wizard/visit/add/workshop/$workshopId",
)({
  component: AddWorkshopRoute,
})

function AddWorkshopRoute() {
  useBounceIfNoCheckout()
  const { workshopId } = Route.useParams()
  const navigate = useNavigate()
  const ctx = useWizardContext()

  const workshop = ctx.pricingConfig.workshops[workshopId as WorkshopId]
  const { data: catalogItems } = useCatalogForWorkshop(workshopId)

  if (!workshop) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Unbekannte Werkstatt"
        description={`Werkstatt "${workshopId}" wurde nicht gefunden.`}
      />
    )
  }

  const wsId = workshopId as WorkshopId

  return (
    <MaterialPicker
      open
      onOpenChange={(open) => {
        if (!open) {
          // Re-assert the page scroll through the dismissal reflow + the
          // router's scroll-to-top so /visit doesn't jump to the top (#451).
          restorePickerScrollAnchor()
          navigate({
            to: "/visit",
            search: ctx.kiosk ? { kiosk: "" } : {},
          })
        }
      }}
      scope={{
        kind: "workshop",
        workshopId: wsId,
        workshopLabel: workshop.label,
      }}
      catalogItems={catalogItems}
      config={ctx.pricingConfig}
      discountLevel={ctx.discountLevel}
      resolveWorkshop={() => wsId}
      onAdd={ctx.addItem}
    />
  )
}
