// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { formatCHF, formatDateTime } from "@/lib/format"
import { UsageItemRow, type UsageItemData } from "./usage-item-row"
import type { PricingConfig, WorkshopId } from "@/lib/workshop-config"

interface MachineUsageItem {
  id: string
  machine: { id: string }
  checkIn: { toDate(): Date }
  checkOut?: { toDate(): Date } | null
  workshop?: string
}

interface WorkshopUsageSectionProps {
  workshopId: WorkshopId
  workshopLabel: string
  machineUsage: MachineUsageItem[]
  materialUsage: UsageItemData[]
  config: PricingConfig
  onAddItem: (workshopId: WorkshopId) => void
  onEditItem: (item: UsageItemData) => void
  onDeleteItem: (item: UsageItemData) => void
}

export function WorkshopUsageSection({
  workshopId,
  workshopLabel,
  machineUsage,
  materialUsage,
  config,
  onAddItem,
  onEditItem,
  onDeleteItem,
}: WorkshopUsageSectionProps) {
  const sectionTotal =
    materialUsage.reduce((s, u) => s + (u.details?.totalPrice ?? 0), 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{workshopLabel}</CardTitle>
          <span className="text-sm font-medium">{formatCHF(sectionTotal)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* NFC machine usage (read-only) */}
        {machineUsage.map((u) => (
          <div key={u.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{u.machine?.id ?? "Maschine"}</div>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(u.checkIn)}
                {u.checkOut ? ` – ${formatDateTime(u.checkOut)}` : (
                  <span className="text-green-600 ml-1">Aktiv</span>
                )}
              </div>
            </div>
            <span className="text-xs text-muted-foreground">NFC</span>
          </div>
        ))}

        {/* Self-reported items (editable) */}
        {materialUsage.map((item) => (
          <UsageItemRow
            key={item.id}
            item={item}
            config={config}
            onEdit={onEditItem}
            onDelete={onDeleteItem}
          />
        ))}

        <Button
          variant="ghost"
          size="sm"
          className="text-cog-teal hover:text-cog-teal-dark mt-1"
          onClick={() => onAddItem(workshopId)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Hinzufügen
        </Button>
      </CardContent>
    </Card>
  )
}
