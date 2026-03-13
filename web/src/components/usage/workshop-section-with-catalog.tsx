// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCatalogForWorkshop } from "@/lib/workshop-config"
import type { PricingConfig, WorkshopId, WorkshopConfig, DiscountLevel } from "@/lib/workshop-config"
import {
  WorkshopInlineSection,
  type CheckoutItemLocal,
  type ItemCallbacks,
} from "@/components/usage/inline-rows"
import { PageLoading } from "@/components/page-loading"

/** Workshop section that loads catalog items for the workshop */
export function WorkshopSectionWithCatalog({
  workshopId,
  workshop,
  config,
  items,
  callbacks,
  discountLevel,
  onBlurSave,
  checkoutId,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  config: PricingConfig
  items: CheckoutItemLocal[]
  callbacks: ItemCallbacks
  discountLevel: DiscountLevel
  onBlurSave?: boolean
  checkoutId?: string | null
}) {
  const { data: rawCatalog, loading } = useCatalogForWorkshop(workshopId)

  if (loading) return <PageLoading />

  // Override addItem to inject discount-level pricing
  const wrappedCallbacks: ItemCallbacks = {
    ...callbacks,
    addItem: (item: CheckoutItemLocal) => {
      let resolved = item
      if (item.catalogId) {
        const cat = rawCatalog.find((c) => c.id === item.catalogId)
        if (cat) {
          resolved = { ...item, unitPrice: cat.unitPrice[discountLevel] ?? cat.unitPrice.none ?? 0 }
        }
      }
      callbacks.addItem(resolved)
    },
  }

  return (
    <WorkshopInlineSection
      workshopId={workshopId}
      workshop={workshop}
      config={config}
      items={items}
      catalogItems={rawCatalog}
      callbacks={wrappedCallbacks}
      discountLevel={discountLevel}
      onBlurSave={onBlurSave}
      checkoutId={checkoutId}
    />
  )
}
