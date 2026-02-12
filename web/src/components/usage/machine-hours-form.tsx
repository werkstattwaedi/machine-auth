// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo } from "react"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import type {
  MachineConfig,
  DiscountLevel,
  PricingConfig,
} from "@/lib/workshop-config"

export interface MachineHoursData {
  machineId: string
  machineLabel: string
  hours: number
  discountLevel: DiscountLevel
  unitPrice: number
  totalPrice: number
}

interface MachineHoursFormProps {
  machines: MachineConfig[]
  config: PricingConfig
  initial?: MachineHoursData
  onChange: (data: MachineHoursData | null) => void
}

export function MachineHoursForm({
  machines,
  config,
  initial,
  onChange,
}: MachineHoursFormProps) {
  const [machineId, setMachineId] = useState(initial?.machineId ?? machines[0]?.id ?? "")
  const [hours, setHours] = useState(initial?.hours ?? 1)
  const [discount, setDiscount] = useState<DiscountLevel>(initial?.discountLevel ?? "none")

  const machine = machines.find((m) => m.id === machineId)

  const { unitPrice, totalPrice } = useMemo(() => {
    if (!machine?.prices) return { unitPrice: 0, totalPrice: 0 }
    const up = machine.prices[discount] ?? 0
    return { unitPrice: up, totalPrice: up * hours }
  }, [machine, discount, hours])

  const emit = (mid: string, h: number, dl: DiscountLevel) => {
    const m = machines.find((x) => x.id === mid)
    if (!m?.prices || h <= 0) { onChange(null); return }
    const up = m.prices[dl] ?? 0
    onChange({
      machineId: mid,
      machineLabel: m.label,
      hours: h,
      discountLevel: dl,
      unitPrice: up,
      totalPrice: up * h,
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-sm font-bold">Maschine</Label>
        <select
          className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"
          value={machineId}
          onChange={(e) => { setMachineId(e.target.value); emit(e.target.value, hours, discount) }}
        >
          {machines.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-sm font-bold">Stunden</Label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={hours}
            onChange={(e) => { const v = parseFloat(e.target.value) || 0; setHours(v); emit(machineId, v, discount) }}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-bold">Rabatt</Label>
          <select
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"
            value={discount}
            onChange={(e) => { const v = e.target.value as DiscountLevel; setDiscount(v); emit(machineId, hours, v) }}
          >
            {(Object.entries(config.discountLabels) as [DiscountLevel, string][]).map(
              ([key, label]) => (
                <option key={key} value={key}>{label}</option>
              )
            )}
          </select>
        </div>
      </div>

      <div className="flex justify-between text-sm pt-2 border-t">
        <span>
          {hours} Std. × {formatCHF(unitPrice)}
        </span>
        <span className="font-bold">{formatCHF(totalPrice)}</span>
      </div>
    </div>
  )
}
