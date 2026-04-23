// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCatalogForWorkshop } from "@modules/lib/workshop-config"
import type { PricingConfig, WorkshopId, WorkshopConfig, DiscountLevel } from "@modules/lib/workshop-config"
import {
  WorkshopInlineSection,
  type CheckoutItemLocal,
  type ItemCallbacks,
} from "@/components/usage/inline-rows"
import { PageLoading } from "@modules/components/page-loading"
import type { ItemErrors } from "@/components/checkout/validation"

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
  itemErrors,
  sectionRef,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  config: PricingConfig
  items: CheckoutItemLocal[]
  callbacks: ItemCallbacks
  discountLevel: DiscountLevel
  onBlurSave?: boolean
  checkoutId?: string | null
  itemErrors?: Record<string, ItemErrors>
  sectionRef?: (el: HTMLDivElement | null) => void
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
          resolved = {
            ...item,
            unitPrice: cat.unitPrice[discountLevel] ?? cat.unitPrice.none ?? 0,
          }
          // SLA items need the two-axis price resolved at add time so the
          // inline row can compute totals without re-querying.
          if (cat.pricingModel === "sla" && cat.slaPricing) {
            resolved.slaPricing = {
              resinPricePerLiter:
                cat.slaPricing.resinPricePerLiter?.[discountLevel] ??
                cat.slaPricing.resinPricePerLiter?.none ??
                0,
              pricePerLayer:
                cat.slaPricing.pricePerLayer?.[discountLevel] ??
                cat.slaPricing.pricePerLayer?.none ??
                0,
            }
          }
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
      itemErrors={itemErrors}
      sectionRef={sectionRef}
    />
  )
}
