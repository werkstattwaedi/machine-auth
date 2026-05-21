// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

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
import type { ItemErrors } from "@/components/checkout/validation"

/**
 * Workshop section host. Originally loaded a per-workshop catalog
 * slice and wrapped the picker's add callback in discount-level price
 * resolution; that work moved into the route-driven picker host in
 * issue #213, so this is now a thin passthrough kept for the existing
 * call sites (step-workshops + visit).
 */
export function WorkshopSectionWithCatalog({
  workshopId,
  workshop,
  items,
  callbacks,
  checkoutId,
  sectionRef,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  /** Unused; kept for backwards-compat with existing call sites. */
  config?: PricingConfig
  items: CheckoutItemLocal[]
  callbacks: ItemCallbacks
  /** Unused; kept for backwards-compat with existing call sites. */
  discountLevel?: DiscountLevel
  /** Legacy; kept for backwards-compat. */
  onBlurSave?: boolean
  checkoutId?: string | null
  /** Legacy; kept for backwards-compat. */
  itemErrors?: Record<string, ItemErrors>
  sectionRef?: (el: HTMLDivElement | null) => void
}) {
  return (
    <WorkshopInlineSection
      workshopId={workshopId}
      workshop={workshop}
      items={items}
      callbacks={callbacks}
      checkoutId={checkoutId}
      sectionRef={sectionRef}
    />
  )
}
