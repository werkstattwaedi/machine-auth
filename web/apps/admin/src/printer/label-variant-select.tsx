// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@modules/components/ui/select"
import { labelVariantOptions } from "./material-label-input"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"

/** Chooses which variant a label preselects. Renders nothing for an item with
 *  only one way to buy it. */
export function LabelVariantSelect({
  item,
  value,
  onChange,
}: {
  item: Pick<CatalogItemDoc, "name" | "variants">
  value: string | undefined
  onChange: (variantId: string) => void
}) {
  const options = labelVariantOptions(item)
  if (options.length < 2) return null
  return (
    <Select value={value ?? options[0].value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className="w-56"
        aria-label={`Variante von ${item.name}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
