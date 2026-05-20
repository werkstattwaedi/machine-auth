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
import { useVisitContext } from "@/routes/_authenticated/visit"
import { PageLoading } from "@modules/components/page-loading"
import { EmptyState } from "@modules/components/empty-state"
import { AlertTriangle } from "lucide-react"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

export const Route = createFileRoute(
  "/_authenticated/visit/add/list/$listId",
)({
  component: AddListRoute,
})

function AddListRoute() {
  const db = useDb()
  const { listId } = Route.useParams()
  const navigate = useNavigate()
  const { pricingConfig, discountLevel, resolveWorkshop, addItem } =
    useVisitContext()

  const { data: priceList, loading: loadingList } = useDocument(
    priceListRef(db, listId),
  )

  // documentId() `in` query caps at 30 entries. Pricelists in practice
  // stay well under this (a single category PDF). If a list grows past
  // the cap, surface the truncation via telemetry so it shows up in
  // observability before users notice missing items.
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
        if (!open) navigate({ to: "/visit" })
      }}
      scope={{ kind: "list", listId, listName: priceList.name }}
      catalogItems={catalogItems}
      config={pricingConfig}
      discountLevel={discountLevel}
      resolveWorkshop={resolveWorkshop}
      onAdd={addItem}
    />
  )
}
