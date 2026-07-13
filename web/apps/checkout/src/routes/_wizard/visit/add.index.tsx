// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCollection } from "@modules/lib/firestore"
import { catalogCollection } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { where } from "firebase/firestore"
import { MaterialPicker } from "@/components/usage/material-picker"
import { restorePickerScrollAnchor } from "@/components/usage/picker-scroll-anchor"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { useBounceIfNoCheckout } from "@/components/checkout/use-bounce-if-no-checkout"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

export const Route = createFileRoute("/_wizard/visit/add/")({
  component: AddIndexRoute,
})

function AddIndexRoute() {
  useBounceIfNoCheckout()
  const db = useDb()
  const navigate = useNavigate()
  const ctx = useWizardContext()

  const { data: catalogItems } = useCollection<CatalogItemDoc>(
    catalogCollection(db),
    where("active", "==", true),
    where("userCanAdd", "==", true),
  )

  return (
    <MaterialPicker
      open
      onOpenChange={(open) => {
        if (!open) {
          // Re-assert the page scroll through the dismissal reflow so /visit
          // doesn't jump to the top (#451). resetScroll keeps the router's
          // delayed scroll-to-top out of the race entirely (#523).
          restorePickerScrollAnchor()
          navigate({
            to: "/visit",
            search: ctx.kiosk ? { kiosk: "" } : {},
            resetScroll: false,
          })
        }
      }}
      scope={{ kind: "all" }}
      catalogItems={catalogItems}
      config={ctx.pricingConfig}
      discountLevel={ctx.discountLevel}
      resolveWorkshop={ctx.resolveWorkshop}
      onAdd={ctx.addItem}
    />
  )
}
