// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCatalogForWorkshop } from "@modules/lib/workshop-config"
import type {
  PricingConfig,
  WorkshopId,
  WorkshopConfig,
  DiscountLevel,
} from "@modules/lib/workshop-config"
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

  // Override addItem to inject discount-level pricing. For SLA items,
  // `unitPrice` is CHF/l of resin (per catalog entry); the per-layer cost
  // is looked up from `PricingConfig.slaLayerPrice` at render time.
  const wrappedCallbacks: ItemCallbacks = {
    ...callbacks,
    addItem: (item: CheckoutItemLocal) => {
      let resolved = item
      if (item.catalogId) {
        const cat = rawCatalog.find((c) => c.id === item.catalogId)
        const variant =
          item.variantId != null
            ? cat?.variants?.find((v) => v.id === item.variantId)
            : cat?.variants?.[0]
        if (variant) {
          const unitPrice =
            discountLevel === "member" &&
            typeof variant.unitPrice.member === "number"
              ? variant.unitPrice.member
              : variant.unitPrice.default
          resolved = { ...item, unitPrice }
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
