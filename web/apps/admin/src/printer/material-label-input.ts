// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { CatalogItemDoc } from "@modules/lib/firestore-entities"
import { buildItemLabelQrUrl } from "./item-label-qr-url"
import type { LabelFormat } from "./label-formats"
import type { MaterialLabelInput } from "./render-material-label"

type LabelledItem = Pick<
  CatalogItemDoc,
  "code" | "name" | "labelName" | "labelMass" | "variants"
>

/** What a variant is called in a chooser; matches the checkout's picker. */
export function labelVariantOptions(item: Pick<LabelledItem, "variants">) {
  return (item.variants ?? []).map((v) => ({
    value: v.id,
    label: v.label ?? "Standard",
  }))
}

/**
 * Build the label for an item, optionally for one of its variants. The first
 * variant is what the checkout preselects anyway, so its label stays the plain
 * item label: same QR link as stickers already on the shelves, and no unit
 * ("Per m²") printed where a named format would go.
 */
export function materialLabelInput(
  checkoutDomain: string,
  item: LabelledItem,
  format: LabelFormat,
  variantId?: string,
): MaterialLabelInput {
  const variant = item.variants?.slice(1).find((v) => v.id === variantId)
  return {
    url: buildItemLabelQrUrl(checkoutDomain, item.code, variant?.id),
    // Curated label fields from the pricelist import when present; items
    // created by hand fall back to the composed display name, no mass line.
    name: item.labelName ?? item.name,
    mass: item.labelMass,
    variant: variant?.label ?? undefined,
    code: `#${item.code}`,
    format,
  }
}
