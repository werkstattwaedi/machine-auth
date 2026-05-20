// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { catalogCollection } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { where } from "firebase/firestore"
import { MaterialPicker } from "@/components/usage/material-picker"
import { useVisitContext } from "@/routes/_authenticated/visit"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

export const Route = createFileRoute("/_authenticated/visit/add/")({
  component: AddIndexRoute,
})

function AddIndexRoute() {
  const db = useDb()
  const navigate = useNavigate()
  const { pricingConfig, discountLevel, resolveWorkshop, addItem } =
    useVisitContext()

  // Full catalog the member is allowed to add — no workshop narrowing.
  // The bare /visit/add entry is the "search anything" / QR-scanner
  // fallback; the category breadcrumbs do the narrowing.
  const { data: catalogItems } = useCollection<CatalogItemDoc>(
    catalogCollection(db),
    where("active", "==", true),
    where("userCanAdd", "==", true),
  )

  return (
    <MaterialPicker
      open
      onOpenChange={(open) => {
        if (!open) navigate({ to: "/visit" })
      }}
      scope={{ kind: "all" }}
      catalogItems={catalogItems}
      config={pricingConfig}
      discountLevel={discountLevel}
      resolveWorkshop={resolveWorkshop}
      onAdd={addItem}
    />
  )
}
