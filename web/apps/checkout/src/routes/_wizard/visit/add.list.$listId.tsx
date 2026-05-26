// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCollection, useDocument } from "@modules/lib/firestore"
import {
  catalogCollection,
  priceListRef,
} from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { documentId, where } from "firebase/firestore"
import { MaterialPicker } from "@/components/usage/material-picker"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

export const Route = createFileRoute("/_wizard/visit/add/list/$listId")({
  component: AddListRoute,
})

function AddListRoute() {
  const db = useDb()
  const { listId } = Route.useParams()
  const navigate = useNavigate()
  const ctx = useWizardContext()

  const { data: priceList, loading: loadingList } = useDocument(
    priceListRef(db, listId),
  )

  const rawItemIds = priceList?.items ?? []
  const itemIds = rawItemIds.slice(0, 30)
  if (rawItemIds.length > itemIds.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `Pricelist ${listId} has ${rawItemIds.length} items; picker only loads the first ${itemIds.length} (Firestore documentId() in [] cap).`,
    )
  }
  const { data: catalogItems, loading: loadingItems } =
    useCollection<CatalogItemDoc>(
      itemIds.length > 0 ? catalogCollection(db) : null,
      where(documentId(), "in", itemIds),
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
          navigate({
            to: "/visit",
            search: ctx.kiosk ? { kiosk: "" } : {},
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
