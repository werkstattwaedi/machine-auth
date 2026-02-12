// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import type { MachineConfig, PrintMaterial } from "@/lib/workshop-config"

export interface ThreeDPrintData {
  machineLabel: string
  weight_g: number
  materialType: PrintMaterial
  totalPrice: number
}

interface ThreeDPrintFormProps {
  machine: MachineConfig
  initial?: ThreeDPrintData
  onChange: (data: ThreeDPrintData | null) => void
}

export function ThreeDPrintForm({
  machine,
  initial,
  onChange,
}: ThreeDPrintFormProps) {
  const materials = Object.keys(machine.materialPrices ?? {}) as PrintMaterial[]
  const [weight, setWeight] = useState(initial?.weight_g ?? 0)
  const [materialType, setMaterialType] = useState<PrintMaterial>(initial?.materialType ?? materials[0] ?? "PLA")

  const pricePerGram = machine.materialPrices?.[materialType] ?? 0
  const totalPrice = useMemo(() => pricePerGram * weight, [pricePerGram, weight])

  const emit = (w: number, mt: PrintMaterial) => {
    if (w <= 0) { onChange(null); return }
    const ppg = machine.materialPrices?.[mt] ?? 0
    onChange({
      machineLabel: machine.label,
      weight_g: w,
      materialType: mt,
      totalPrice: ppg * w,
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{machine.label}</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-bold">Gewicht (g)</Label>
          <input
            type="number" min="0" step="1"
            value={weight || ""}
            onChange={(e) => { const v = parseFloat(e.target.value) || 0; setWeight(v); emit(v, materialType) }}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-bold">Material</Label>
          <select
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"
            value={materialType}
            onChange={(e) => { const v = e.target.value as PrintMaterial; setMaterialType(v); emit(weight, v) }}
          >
            {materials.map((mt) => (
              <option key={mt} value={mt}>
                {mt} ({formatCHF(machine.materialPrices?.[mt] ?? 0)}/g)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-between text-sm pt-2 border-t">
        <span>
          {weight}g × {formatCHF(pricePerGram)}/g
        </span>
        <span className="font-bold">{formatCHF(totalPrice)}</span>
      </div>
    </div>
  )
}
