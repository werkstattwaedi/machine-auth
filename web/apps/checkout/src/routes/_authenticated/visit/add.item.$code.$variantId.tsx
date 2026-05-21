// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { catalogCollection } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { limit, where } from "firebase/firestore"
import { MaterialPicker } from "@/components/usage/material-picker"
import { useVisitContext } from "@/routes/_authenticated/visit"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

export const Route = createFileRoute(
  "/_authenticated/visit/add/item/$code/$variantId",
)({
  component: AddItemVariantRoute,
})

function AddItemVariantRoute() {
  const db = useDb()
  const { code, variantId } = Route.useParams()
  const navigate = useNavigate()
  const { pricingConfig, discountLevel, resolveWorkshop, addItem } =
    useVisitContext()

  // Same code lookup as `/visit/add/item/$code`; the only difference is
  // we hand the picker a pre-selected variantId (per-variant QR sticker
  // payload, e.g. a Zuschnitt A3 sheet labelled with code+variant).
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
        if (!open) navigate({ to: "/visit" })
      }}
      scope={{ kind: "item", code, itemId: item.id, variantId }}
      catalogItems={[item]}
      config={pricingConfig}
      discountLevel={discountLevel}
      resolveWorkshop={resolveWorkshop}
      onAdd={addItem}
    />
  )
}
