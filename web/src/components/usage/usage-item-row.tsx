// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Button } from "@/components/ui/button"
import { formatCHF } from "@/lib/format"
import { Pencil, Trash2 } from "lucide-react"
import type { PricingConfig, UnitCategory } from "@/lib/workshop-config"

export interface UsageItemData {
  id: string
  description: string
  workshop: string
  type?: "material" | "machine_hours" | "service"
  details?: {
    category?: string
    quantity?: number
    totalPrice?: number
    discountLevel?: string
    objectSize?: string
    weight_g?: number
    materialType?: string
    serviceDescription?: string
    serviceCost?: number
  }
}

interface UsageItemRowProps {
  item: UsageItemData
  config: PricingConfig
  readOnly?: boolean
  onEdit?: (item: UsageItemData) => void
  onDelete?: (item: UsageItemData) => void
}

function formatQuantity(item: UsageItemData, config: PricingConfig): string {
  const d = item.details
  if (!d?.category || d.quantity == null) return ""
  const unitLabel = config.unitLabels[d.category as UnitCategory] ?? d.category
  return `${d.quantity} ${unitLabel}`
}

export function UsageItemRow({
  item,
  config,
  readOnly,
  onEdit,
  onDelete,
}: UsageItemRowProps) {
  const price = item.details?.totalPrice ?? 0

  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{item.description}</div>
        <div className="text-xs text-muted-foreground">
          {formatQuantity(item, config)}
          {item.details?.discountLevel && item.details.discountLevel !== "none" && (
            <span className="ml-2">
              ({config.discountLabels[item.details.discountLevel as keyof typeof config.discountLabels] ?? item.details.discountLevel})
            </span>
          )}
          {item.details?.serviceDescription && (
            <span className="ml-2">+ {item.details.serviceDescription}</span>
          )}
        </div>
      </div>
      <div className="font-medium whitespace-nowrap">{formatCHF(price)}</div>
      {!readOnly && (
        <div className="flex gap-1">
          {onEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onEdit(item)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(item)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
