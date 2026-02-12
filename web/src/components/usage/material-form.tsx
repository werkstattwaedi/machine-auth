// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useEffect } from "react"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import type { UnitCategory, PricingConfig } from "@/lib/workshop-config"

export interface MaterialData {
  description: string
  category: UnitCategory
  quantity: number
  lengthCm?: number
  widthCm?: number
  unitPrice: number
  totalPrice: number
  serviceDescription?: string
  serviceCost?: number
}

interface MaterialFormProps {
  categories: UnitCategory[]
  config: PricingConfig
  initial?: MaterialData
  onChange: (data: MaterialData | null) => void
}

function calcQuantity(cat: UnitCategory, lengthCm: number, widthCm: number, rawQty: number): number {
  if (cat === "m2") return (lengthCm / 100) * (widthCm / 100)
  if (cat === "m") return lengthCm / 100
  return rawQty
}

export function MaterialForm({
  categories,
  config,
  initial,
  onChange,
}: MaterialFormProps) {
  const [category, setCategory] = useState<UnitCategory>(initial?.category ?? categories[0] ?? "stk")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [lengthCm, setLengthCm] = useState(initial?.lengthCm ?? 0)
  const [widthCm, setWidthCm] = useState(initial?.widthCm ?? 0)
  const [rawQty, setRawQty] = useState(initial?.quantity ?? 1)
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice ?? 0)
  const [serviceDescription, setServiceDescription] = useState(initial?.serviceDescription ?? "")
  const [serviceCost, setServiceCost] = useState(initial?.serviceCost ?? 0)

  const quantity = useMemo(
    () => calcQuantity(category, lengthCm, widthCm, rawQty),
    [category, lengthCm, widthCm, rawQty],
  )

  const materialPrice = category === "chf" ? unitPrice : quantity * unitPrice
  const totalPrice = materialPrice + serviceCost

  useEffect(() => {
    if (!description.trim()) { onChange(null); return }
    onChange({
      description,
      category,
      quantity: category === "chf" ? 1 : quantity,
      lengthCm: (category === "m2" || category === "m") ? lengthCm : undefined,
      widthCm: category === "m2" ? widthCm : undefined,
      unitPrice: category === "chf" ? totalPrice : unitPrice,
      totalPrice,
      serviceDescription: serviceDescription || undefined,
      serviceCost: serviceCost || undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, category, quantity, lengthCm, widthCm, unitPrice, serviceDescription, serviceCost])

  const unitLabel = config.unitLabels[category] ?? category

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-sm font-bold">Beschreibung</Label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="z.B. Sperrholz Birke"
          className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm font-bold">Kategorie</Label>
        <select
          className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value as UnitCategory)}
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>{config.unitLabels[cat] ?? cat}</option>
          ))}
        </select>
      </div>

      {category === "m2" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-sm font-bold">Länge (cm)</Label>
            <input
              type="number" min="0" step="1"
              value={lengthCm || ""}
              onChange={(e) => setLengthCm(parseFloat(e.target.value) || 0)}
              className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-bold">Breite (cm)</Label>
            <input
              type="number" min="0" step="1"
              value={widthCm || ""}
              onChange={(e) => setWidthCm(parseFloat(e.target.value) || 0)}
              className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
            />
          </div>
        </div>
      )}

      {category === "m" && (
        <div className="space-y-1">
          <Label className="text-sm font-bold">Länge (cm)</Label>
          <input
            type="number" min="0" step="1"
            value={lengthCm || ""}
            onChange={(e) => setLengthCm(parseFloat(e.target.value) || 0)}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
      )}

      {(category === "stk" || category === "kg" || category === "g" || category === "l") && (
        <div className="space-y-1">
          <Label className="text-sm font-bold">Menge ({unitLabel})</Label>
          <input
            type="number" min="0" step={category === "stk" ? "1" : "0.1"}
            value={rawQty || ""}
            onChange={(e) => setRawQty(parseFloat(e.target.value) || 0)}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
      )}

      {category !== "chf" && (
        <div className="space-y-1">
          <Label className="text-sm font-bold">Preis / {unitLabel}</Label>
          <input
            type="number" min="0" step="0.05"
            value={unitPrice || ""}
            onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
      )}

      {category === "chf" && (
        <div className="space-y-1">
          <Label className="text-sm font-bold">Betrag (CHF)</Label>
          <input
            type="number" min="0" step="0.05"
            value={unitPrice || ""}
            onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
      )}

      {category === "m2" && quantity > 0 && (
        <p className="text-xs text-muted-foreground">
          = {quantity.toFixed(2)} {unitLabel}
        </p>
      )}
      {category === "m" && quantity > 0 && (
        <p className="text-xs text-muted-foreground">
          = {quantity.toFixed(2)} {unitLabel}
        </p>
      )}

      <div className="border-t pt-4 space-y-3">
        <Label className="text-sm font-bold">Bezogene Leistungen (optional)</Label>
        <input
          value={serviceDescription}
          onChange={(e) => setServiceDescription(e.target.value)}
          placeholder="z.B. Zuschnitt"
          className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
        />
        <div className="space-y-1">
          <Label className="text-sm font-bold">Kosten CHF</Label>
          <input
            type="number" min="0" step="0.50"
            value={serviceCost || ""}
            onChange={(e) => setServiceCost(parseFloat(e.target.value) || 0)}
            className="flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>
      </div>

      <div className="flex justify-between text-sm pt-2 border-t">
        <span>Total</span>
        <span className="font-bold">{formatCHF(totalPrice)}</span>
      </div>
    </div>
  )
}
