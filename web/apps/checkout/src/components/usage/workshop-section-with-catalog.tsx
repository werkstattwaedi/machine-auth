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
import type { CatalogItem } from "@modules/lib/workshop-config"
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
  onAddMaterial,
  onRemoveWorkshop,
  pinnedCatalog,
  discountLevel,
  footerSlot,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  /** Unused; kept for backwards-compat with existing call sites. */
  config?: PricingConfig
  items: CheckoutItemLocal[]
  callbacks: ItemCallbacks
  /** Member/default tier for pinned-machine pricing (issue #105). */
  discountLevel?: DiscountLevel
  /** Catalog docs for this workshop's pinned machines (issue #105). */
  pinnedCatalog?: CatalogItem[]
  /** Legacy; kept for backwards-compat. */
  onBlurSave?: boolean
  checkoutId?: string | null
  /** Legacy; kept for backwards-compat. */
  itemErrors?: Record<string, ItemErrors>
  onAddMaterial: () => void
  /** Remove-workshop (×) in the section header (Werkstatt-Auswahl handoff). */
  onRemoveWorkshop?: () => void
  /** Extra content below the material box (issue #505). */
  footerSlot?: React.ReactNode
}) {
  return (
    <WorkshopInlineSection
      workshopId={workshopId}
      workshop={workshop}
      items={items}
      callbacks={callbacks}
      checkoutId={checkoutId}
      onAddMaterial={onAddMaterial}
      onRemoveWorkshop={onRemoveWorkshop}
      pinnedCatalog={pinnedCatalog}
      discountLevel={discountLevel}
      footerSlot={footerSlot}
    />
  )
}
