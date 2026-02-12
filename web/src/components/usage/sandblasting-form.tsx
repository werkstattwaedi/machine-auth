// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import type { MachineConfig, ObjectSize, PricingConfig } from "@/lib/workshop-config"

export interface SandblastingData {
  machineLabel: string
  quantity: number
  objectSize: ObjectSize
  totalPrice: number
}

interface SandblastingFormProps {
  machine: MachineConfig
  config: PricingConfig
  initial?: SandblastingData
  onChange: (data: SandblastingData | null) => void
}

export function SandblastingForm({
  machine,
  config,
  initial,
  onChange,
}: SandblastingFormProps) {
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1)
  const [objectSize, setObjectSize] = useState<ObjectSize>(initial?.objectSize ?? "klein")

  const pricePerObj = machine.objectSizePrices?.[objectSize] ?? 0
  const totalPrice = useMemo(() => pricePerObj * quantity, [pricePerObj, quantity])

  const emit = (q: number, os: ObjectSize) => {
    if (q <= 0) { onChange(null); return }
    const pp = machine.objectSizePrices?.[os] ?? 0
    onChange({
      machineLabel: machine.label,
      quantity: q,
      objectSize: os,
      totalPrice: pp * q,
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{machine.label}</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-bold">Anzahl</Label>
          <input
            type="number" min="1" step="1"
            value={quantity}
            onChange={(e) => { const v = parseInt(e.target.value) || 0; setQuantity(v); emit(v, objectSize) }}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-bold">Grösse</Label>
          <select
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"
            value={objectSize}
            onChange={(e) => { const v = e.target.value as ObjectSize; setObjectSize(v); emit(quantity, v) }}
          >
            {(Object.entries(config.objectSizeLabels) as [ObjectSize, string][]).map(
              ([key, label]) => (
                <option key={key} value={key}>{label} ({formatCHF(machine.objectSizePrices?.[key] ?? 0)})</option>
              )
            )}
          </select>
        </div>
      </div>

      <div className="flex justify-between text-sm pt-2 border-t">
        <span>
          {quantity} × {config.objectSizeLabels[objectSize]} ({formatCHF(pricePerObj)})
        </span>
        <span className="font-bold">{formatCHF(totalPrice)}</span>
      </div>
    </div>
  )
}
