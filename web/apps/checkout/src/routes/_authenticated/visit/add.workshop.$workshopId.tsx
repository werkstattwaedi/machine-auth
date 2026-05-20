// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCatalogForWorkshop } from "@modules/lib/workshop-config"
import type { WorkshopId } from "@modules/lib/workshop-config"
import { MaterialPicker } from "@/components/usage/material-picker"
import { useVisitContext } from "@/routes/_authenticated/visit"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"

export const Route = createFileRoute(
  "/_authenticated/visit/add/workshop/$workshopId",
)({
  component: AddWorkshopRoute,
})

function AddWorkshopRoute() {
  const { workshopId } = Route.useParams()
  const navigate = useNavigate()
  const { pricingConfig, discountLevel, addItem } = useVisitContext()

  const workshop = pricingConfig.workshops[workshopId as WorkshopId]
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
        if (!open) navigate({ to: "/visit" })
      }}
      scope={{
        kind: "workshop",
        workshopId: wsId,
        workshopLabel: workshop.label,
      }}
      catalogItems={catalogItems}
      config={pricingConfig}
      discountLevel={discountLevel}
      resolveWorkshop={() => wsId}
      onAdd={addItem}
    />
  )
}
