// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { UseFormRegister } from "react-hook-form"

export interface CatalogFormValues {
  code: string
  name: string
  description: string
  workshops: string
  pricingModel: string
  priceNone: string
  priceMember: string
  priceIntern: string
  active: boolean
  userCanAdd: boolean
}

export function CatalogFormFields({
  register,
  showActive,
}: {
  register: UseFormRegister<CatalogFormValues>
  showActive?: boolean
}) {
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
