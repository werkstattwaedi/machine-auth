// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { useWatch, type Control, type UseFormRegister } from "react-hook-form"

export interface CatalogFormValues {
  code: string
  name: string
  description: string
  workshops: string
  pricingModel: string
  priceNone: string
  priceMember: string
  priceIntern: string
  // SLA-only: resin price per liter × discount level (CHF/L)
  resinPricePerLiterNone: string
  resinPricePerLiterMember: string
  resinPricePerLiterIntern: string
  // SLA-only: price per printed layer × discount level (CHF/layer)
  pricePerLayerNone: string
  pricePerLayerMember: string
  pricePerLayerIntern: string
  active: boolean
  userCanAdd: boolean
}

export function CatalogFormFields({
  register,
  control,
  showActive,
}: {
  register: UseFormRegister<CatalogFormValues>
  control: Control<CatalogFormValues>
  showActive?: boolean
}) {
  // Conditionally reveal the SLA-specific price axes.
  const pricingModel = useWatch({ control, name: "pricingModel" })
  const isSla = pricingModel === "sla"

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Code</Label>
          <Input placeholder="z.B. 1042" {...register("code", { required: true })} />
        </div>
        <div className="space-y-2">
          <Label>Name</Label>
          <Input placeholder="z.B. Sperrholz Birke 4mm" {...register("name", { required: true })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Beschreibung</Label>
        <Input {...register("description")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Werkstätten (kommagetrennt)</Label>
          <Input placeholder="holz, metall" {...register("workshops")} />
        </div>
        <div className="space-y-2">
          <Label>Preismodell</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            {...register("pricingModel")}
          >
            <option value="time">Zeit (Std.)</option>
            <option value="area">Fläche (m²)</option>
            <option value="length">Länge (m)</option>
            <option value="count">Stück</option>
            <option value="weight">Gewicht (kg)</option>
            <option value="direct">Betrag (CHF)</option>
            <option value="sla">SLA Druck (Resin + Layer)</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Preis (Voll)</Label>
          <Input type="number" step="0.01" {...register("priceNone", { required: true })} />
        </div>
        <div className="space-y-2">
          <Label>Preis (Mitglied)</Label>
          <Input type="number" step="0.01" {...register("priceMember")} />
        </div>
        <div className="space-y-2">
          <Label>Preis (Intern)</Label>
          <Input type="number" step="0.01" {...register("priceIntern")} />
        </div>
      </div>
      {isSla && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Resin CHF/L (Voll)</Label>
              <Input
                type="number"
                step="0.01"
                {...register("resinPricePerLiterNone")}
              />
            </div>
            <div className="space-y-2">
              <Label>Resin CHF/L (Mitglied)</Label>
              <Input
                type="number"
                step="0.01"
                {...register("resinPricePerLiterMember")}
              />
            </div>
            <div className="space-y-2">
              <Label>Resin CHF/L (Intern)</Label>
              <Input
                type="number"
                step="0.01"
                {...register("resinPricePerLiterIntern")}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>CHF/Layer (Voll)</Label>
              <Input
                type="number"
                step="0.0001"
                {...register("pricePerLayerNone")}
              />
            </div>
            <div className="space-y-2">
              <Label>CHF/Layer (Mitglied)</Label>
              <Input
                type="number"
                step="0.0001"
                {...register("pricePerLayerMember")}
              />
            </div>
            <div className="space-y-2">
              <Label>CHF/Layer (Intern)</Label>
              <Input
                type="number"
                step="0.0001"
                {...register("pricePerLayerIntern")}
              />
            </div>
          </div>
        </>
      )}
      <div className="flex items-center gap-4">
        {showActive && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" {...register("active")} />
            <Label htmlFor="active">Aktiv</Label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="userCanAdd" {...register("userCanAdd")} />
          <Label htmlFor="userCanAdd">Benutzer kann hinzufügen</Label>
        </div>
      </div>
    </>
  )
}
