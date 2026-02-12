// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"

export interface ServiceData {
  description: string
  serviceCost: number
}

interface ServiceFormProps {
  initial?: ServiceData
  onChange: (data: ServiceData | null) => void
}

export function ServiceForm({ initial, onChange }: ServiceFormProps) {
  const [description, setDescription] = useState(initial?.description ?? "")
  const [cost, setCost] = useState(initial?.serviceCost ?? 0)

  useEffect(() => {
    if (!description.trim() || cost <= 0) { onChange(null); return }
    onChange({ description, serviceCost: cost })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, cost])

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-sm font-bold">Beschreibung</Label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="z.B. Diverses Maker Space"
          className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm font-bold">Kosten (CHF)</Label>
        <input
          type="number" min="0" step="0.50"
          value={cost || ""}
          onChange={(e) => setCost(parseFloat(e.target.value) || 0)}
          className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
        />
      </div>

      <div className="flex justify-between text-sm pt-2 border-t">
        <span>Total</span>
        <span className="font-bold">{formatCHF(cost)}</span>
      </div>
    </div>
  )
}
