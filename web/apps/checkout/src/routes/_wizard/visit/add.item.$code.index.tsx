// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { catalogCollection } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { limit, where } from "firebase/firestore"
import { MaterialPicker } from "@/components/usage/material-picker"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { useBounceIfNoCheckout } from "@/components/checkout/use-bounce-if-no-checkout"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

export const Route = createFileRoute("/_wizard/visit/add/item/$code/")({
  component: AddItemRoute,
})

function AddItemRoute() {
  useBounceIfNoCheckout()
  const db = useDb()
  const { code } = Route.useParams()
  const navigate = useNavigate()
  const ctx = useWizardContext()

  const { data: matches, loading } = useCollection<CatalogItemDoc>(
    catalogCollection(db),
    where("code", "==", code),
    limit(1),
  )

  if (loading) return <PageLoading />

  const item = matches[0]
  if (!item) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Unbekannter Artikel"
        description={`Kein Material mit Code "${code}" gefunden.`}
      />
    )
  }

  return (
    <MaterialPicker
      open
      onOpenChange={(open) => {
        if (!open) {
          navigate({
            to: "/visit",
            search: ctx.kiosk ? { kiosk: "" } : {},
          })
        }
      }}
      scope={{ kind: "item", code, itemId: item.id }}
      catalogItems={[item]}
      config={ctx.pricingConfig}
      discountLevel={ctx.discountLevel}
      resolveWorkshop={ctx.resolveWorkshop}
      onAdd={ctx.addItem}
    />
  )
}
