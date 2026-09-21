// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useDocument, useDocumentsByIds } from "@modules/lib/firestore"
import {
  catalogCollection,
  priceListRef,
} from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { MaterialPicker } from "@/components/usage/material-picker"
import { restorePickerScrollAnchor } from "@/components/usage/picker-scroll-anchor"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { useBounceIfNoCheckout } from "@/components/checkout/use-bounce-if-no-checkout"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

export const Route = createFileRoute("/_wizard/visit/add/list/$listId")({
  component: AddListRoute,
})

function AddListRoute() {
  useBounceIfNoCheckout()
  const db = useDb()
  const { listId } = Route.useParams()
  const navigate = useNavigate()
  const ctx = useWizardContext()

  const { data: priceList, loading: loadingList } = useDocument(
    priceListRef(db, listId),
  )

  // Chunked by id under the hood — a list longer than 30 items used to be
  // cut off at Firestore's `in` operand cap (#632).
  const { data: catalogItems, loading: loadingItems } =
    useDocumentsByIds<CatalogItemDoc>(
      catalogCollection(db),
      priceList?.items ?? [],
    )

  if (loadingList || loadingItems) return <PageLoading />

  if (!priceList) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Preisliste nicht gefunden"
        description={`Die Preisliste "${listId}" existiert nicht oder wurde entfernt.`}
      />
    )
  }

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
      scope={{ kind: "list", listId, listName: priceList.name }}
      catalogItems={catalogItems}
      config={ctx.pricingConfig}
      discountLevel={ctx.discountLevel}
      resolveWorkshop={ctx.resolveWorkshop}
      onAdd={ctx.addItem}
    />
  )
}
