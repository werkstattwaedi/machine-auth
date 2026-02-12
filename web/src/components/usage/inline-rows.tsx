// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useCallback, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import { Plus, X } from "lucide-react"
import type {
  PricingConfig,
  WorkshopId,
  WorkshopConfig,
  MachineConfig,
  DiscountLevel,
  ObjectSize,
  PrintMaterial,
  UnitCategory,
} from "@/lib/workshop-config"

/** Shape of a local material item (shared between checkout reducer and dashboard) */
export interface LocalMaterialItem {
  id: string
  description: string
  workshop: string
  type: "material" | "machine_hours" | "service"
  details: {
    category?: string
    quantity?: number
    lengthCm?: number
    widthCm?: number
    unitPrice?: number
    totalPrice?: number
    discountLevel?: string
    objectSize?: string
    weight_g?: number
    materialType?: string
    serviceDescription?: string
    serviceCost?: number
  }
}

/** Raw Firestore material doc shape (for logged-in users' existing items) */
export interface RawMaterialDoc {
  id: string
  description: string
  workshop?: string
  type?: "material" | "machine_hours" | "service"
  details?: {
    category?: string
    quantity?: number
    lengthCm?: number
    widthCm?: number
    unitPrice?: number
    totalPrice?: number
    discountLevel?: string
    objectSize?: string
    weight_g?: number
    materialType?: string
    serviceDescription?: string
    serviceCost?: number
  }
}

/** Generic callbacks for adding/updating/removing items */
export interface ItemCallbacks {
  addItem: (item: LocalMaterialItem) => void
  updateItem: (id: string, item: LocalMaterialItem) => void
  removeItem: (id: string) => void
}

// --- Shared input styles ---
export const INPUT_CLS =
  "flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
export const SELECT_CLS =
  "flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"

export function calcMaterialQty(cat: string, l: number, w: number, q: number): number {
  if (cat === "m2") return (l / 100) * (w / 100)
  if (cat === "m") return l / 100
  return q
}

// ---------------------------------------------------------------------------
// Inline row: Machine hours (one row per hourly machine, always visible)
// ---------------------------------------------------------------------------

export function MachineHoursRow({
  machine,
  workshopId,
  config,
  existingItem,
  callbacks,
  onBlurSave,
}: {
  machine: MachineConfig
  workshopId: WorkshopId
  config: PricingConfig
  existingItem?: LocalMaterialItem
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const [hours, setHours] = useState(existingItem?.details.quantity ?? 0)
  const [discount, setDiscount] = useState<DiscountLevel>(
    (existingItem?.details.discountLevel as DiscountLevel) ?? "none",
  )
  const itemIdRef = useRef<string | null>(existingItem?.id ?? null)

  const rate = machine.prices?.[discount] ?? 0
  const total = hours * rate

  const sync = useCallback(
    (h: number, dl: DiscountLevel) => {
      const r = machine.prices?.[dl] ?? 0
      const t = h * r
      if (h > 0) {
        const item: LocalMaterialItem = {
          id: itemIdRef.current ?? crypto.randomUUID(),
          description: machine.label,
          workshop: workshopId,
          type: "machine_hours",
          details: {
            category: "h",
            quantity: h,
            unitPrice: r,
            totalPrice: t,
            discountLevel: dl,
          },
        }
        if (itemIdRef.current) {
          callbacks.updateItem(itemIdRef.current, item)
        } else {
          itemIdRef.current = item.id
          callbacks.addItem(item)
        }
      } else if (itemIdRef.current) {
        callbacks.removeItem(itemIdRef.current)
        itemIdRef.current = null
      }
    },
    [machine, workshopId, callbacks],
  )

  return (
    <div>
      <h3 className="text-sm font-bold mb-2">Nutzung {machine.label}</h3>
      <div className="grid grid-cols-4 gap-4 items-end">
        <div>
          <Label className="text-xs font-bold">Anzahl Stunden</Label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={hours || ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              setHours(v)
              if (!onBlurSave) sync(v, discount)
            }}
            onBlur={onBlurSave ? () => sync(hours, discount) : undefined}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <Label className="text-xs font-bold">Rabatt</Label>
          <select
            value={discount}
            onChange={(e) => {
              const v = e.target.value as DiscountLevel
              setDiscount(v)
              sync(hours, v)
            }}
            className={SELECT_CLS}
          >
            {(Object.entries(config.discountLabels) as [DiscountLevel, string][]).map(
              ([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
        <div>
          <Label className="text-xs font-bold">Kosten/h</Label>
          <div className="h-9 flex items-center text-sm">{formatCHF(rate)}</div>
        </div>
        <div>
          <Label className="text-xs font-bold">Zwischentotal</Label>
          <div className="h-9 flex items-center text-sm font-medium">{formatCHF(total)}</div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline row: Sandblasting object (multi-row add/remove)
// ---------------------------------------------------------------------------

export function SandblastingRow({
  item,
  machine,
  config,
  index,
  callbacks,
  onBlurSave,
}: {
  item: LocalMaterialItem
  machine: MachineConfig
  config: PricingConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const [quantity, setQuantity] = useState(item.details.quantity ?? 1)
  const [objectSize, setObjectSize] = useState<ObjectSize>(
    (item.details.objectSize as ObjectSize) ?? "klein",
  )

  const doUpdate = (q: number, os: ObjectSize) => {
    const unitPrice = machine.objectSizePrices?.[os] ?? 0
    callbacks.updateItem(item.id, {
      ...item,
      details: {
        ...item.details,
        category: "obj",
        quantity: q,
        objectSize: os,
        unitPrice,
        totalPrice: q * unitPrice,
      },
    })
  }

  return (
    <Card className="bg-muted/30">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold">Objekt {index + 1}</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => callbacks.removeItem(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-bold">Anzahl</Label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 1
                setQuantity(v)
                if (!onBlurSave) doUpdate(v, objectSize)
              }}
              onBlur={onBlurSave ? () => doUpdate(quantity, objectSize) : undefined}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <Label className="text-xs font-bold">Grösse</Label>
            <select
              value={objectSize}
              onChange={(e) => {
                const v = e.target.value as ObjectSize
                setObjectSize(v)
                doUpdate(quantity, v)
              }}
              className={SELECT_CLS}
            >
              {(Object.entries(config.objectSizeLabels) as [ObjectSize, string][]).map(
                ([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Inline row: 3D print object (multi-row add/remove)
// ---------------------------------------------------------------------------

export function ThreeDPrintRow({
  item,
  machine,
  index,
  callbacks,
  onBlurSave,
}: {
  item: LocalMaterialItem
  machine: MachineConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const [weight, setWeight] = useState(item.details.weight_g ?? item.details.quantity ?? 0)
  const [materialType, setMaterialType] = useState<PrintMaterial>(
    (item.details.materialType as PrintMaterial) ?? "PLA",
  )
  const materials = Object.keys(machine.materialPrices ?? {}) as PrintMaterial[]
  const unitPrice = machine.materialPrices?.[materialType] ?? 0
  const total = weight * unitPrice

  const doUpdate = (w: number, mt: PrintMaterial) => {
    const up = machine.materialPrices?.[mt] ?? 0
    callbacks.updateItem(item.id, {
      ...item,
      details: {
        ...item.details,
        category: "g",
        quantity: w,
        weight_g: w,
        materialType: mt,
        unitPrice: up,
        totalPrice: w * up,
      },
    })
  }

  return (
    <Card className="bg-muted/30">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold">Objekt {index + 1}</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => callbacks.removeItem(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <Label className="text-xs font-bold">Gewicht (g)</Label>
            <input
              type="number"
              min="0"
              step="1"
              value={weight || ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0
                setWeight(v)
                if (!onBlurSave) doUpdate(v, materialType)
              }}
              onBlur={onBlurSave ? () => doUpdate(weight, materialType) : undefined}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <Label className="text-xs font-bold">Kategorie</Label>
            <select
              value={materialType}
              onChange={(e) => {
                const v = e.target.value as PrintMaterial
                setMaterialType(v)
                doUpdate(weight, v)
              }}
              className={SELECT_CLS}
            >
              {materials.map((mt) => (
                <option key={mt} value={mt}>
                  {mt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs font-bold">Betrag</Label>
            <div className="h-9 flex items-center text-sm font-medium">{formatCHF(total)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Inline row: Material article (multi-row, category-dependent fields)
// ---------------------------------------------------------------------------

export function MaterialArticleRow({
  item,
  categories,
  config,
  index,
  callbacks,
  onBlurSave,
}: {
  item: LocalMaterialItem
  categories: UnitCategory[]
  config: PricingConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const [category, setCategory] = useState<UnitCategory | "">(
    (item.details.category ?? "") as UnitCategory | "",
  )
  const [description, setDescription] = useState(item.description)
  const [lengthCm, setLengthCm] = useState(item.details.lengthCm ?? 0)
  const [widthCm, setWidthCm] = useState(item.details.widthCm ?? 0)
  const [rawQty, setRawQty] = useState(item.details.quantity ?? 0)
  const [unitPrice, setUnitPrice] = useState(item.details.unitPrice ?? 0)

  const computedQty = category ? calcMaterialQty(category, lengthCm, widthCm, rawQty) : 0
  const totalPrice = category === "chf" ? unitPrice : computedQty * unitPrice
  const unitLabel = category ? (config.unitLabels[category as UnitCategory] ?? category) : ""

  const doUpdate = (changes: Partial<{
    description: string
    category: string
    lengthCm: number
    widthCm: number
    quantity: number
    unitPrice: number
  }>) => {
    const newCat = changes.category ?? (category || "")
    const newDesc = changes.description ?? description
    const newL = changes.lengthCm ?? lengthCm
    const newW = changes.widthCm ?? widthCm
    const newQ = changes.quantity ?? rawQty
    const newUp = changes.unitPrice ?? unitPrice
    const q = calcMaterialQty(newCat, newL, newW, newQ)
    const tp = newCat === "chf" ? newUp : q * newUp

    callbacks.updateItem(item.id, {
      ...item,
      description: newDesc,
      details: {
        category: newCat || undefined,
        quantity: newCat === "chf" ? 1 : q,
        lengthCm: newCat === "m2" || newCat === "m" ? newL : undefined,
        widthCm: newCat === "m2" ? newW : undefined,
        unitPrice: newCat === "chf" ? tp : newUp,
        totalPrice: tp,
      },
    })
  }

  // For onBlurSave: flush current local state
  const flushAll = () => doUpdate({})

  // Helper: handle text/number input change (local state only when onBlurSave)
  const handleNumberChange = (
    setter: (v: number) => void,
    field: string,
  ) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value) || 0
    setter(v)
    if (!onBlurSave) doUpdate({ [field]: v })
  }

  return (
    <Card className="bg-muted/30">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold">Artikel {index + 1}</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => callbacks.removeItem(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Category + Description */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <Label className="text-xs font-bold">Kategorie</Label>
            <select
              value={category}
              onChange={(e) => {
                const v = e.target.value as UnitCategory | ""
                setCategory(v)
                doUpdate({ category: v })
              }}
              className={SELECT_CLS}
            >
              <option value="">Bitte wählen</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {config.unitLabels[cat] ?? cat}
                </option>
              ))}
            </select>
          </div>
          {category && (
            <div>
              <Label className="text-xs font-bold">Material *</Label>
              <input
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  if (!onBlurSave) doUpdate({ description: e.target.value })
                }}
                onBlur={onBlurSave ? () => doUpdate({ description }) : undefined}
                placeholder="Was hast du gebraucht?"
                className={INPUT_CLS}
              />
            </div>
          )}
        </div>

        {/* m2: Länge, Breite, m2 (computed), Preis/m2, Betrag */}
        {category === "m2" && (
          <div className="grid grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs font-bold">Länge (cm)</Label>
              <input
                type="number"
                min="0"
                step="1"
                value={lengthCm || ""}
                onChange={handleNumberChange(setLengthCm, "lengthCm")}
                onBlur={onBlurSave ? flushAll : undefined}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">Breite (cm)</Label>
              <input
                type="number"
                min="0"
                step="1"
                value={widthCm || ""}
                onChange={handleNumberChange(setWidthCm, "widthCm")}
                onBlur={onBlurSave ? flushAll : undefined}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">{unitLabel}</Label>
              <input
                type="text"
                readOnly
                value={computedQty.toFixed(2)}
                className={INPUT_CLS + " bg-muted"}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">Preis/{unitLabel}</Label>
              <input
                type="number"
                min="0"
                step="0.05"
                value={unitPrice || ""}
                onChange={handleNumberChange(setUnitPrice, "unitPrice")}
                onBlur={onBlurSave ? flushAll : undefined}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">Betrag</Label>
              <div className="h-9 flex items-center text-sm font-medium">
                {formatCHF(totalPrice)}
              </div>
            </div>
          </div>
        )}

        {/* m: Länge, Preis/m, Betrag */}
        {category === "m" && (
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <Label className="text-xs font-bold">Länge (cm)</Label>
              <input
                type="number"
                min="0"
                step="1"
                value={lengthCm || ""}
                onChange={handleNumberChange(setLengthCm, "lengthCm")}
                onBlur={onBlurSave ? flushAll : undefined}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">Preis/{unitLabel}</Label>
              <input
                type="number"
                min="0"
                step="0.05"
                value={unitPrice || ""}
                onChange={handleNumberChange(setUnitPrice, "unitPrice")}
                onBlur={onBlurSave ? flushAll : undefined}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">Betrag</Label>
              <div className="h-9 flex items-center text-sm font-medium">
                {formatCHF(totalPrice)}
              </div>
            </div>
          </div>
        )}

        {/* stk/kg/g/l: Anzahl, Preis/unit, Betrag */}
        {(category === "stk" ||
          category === "kg" ||
          category === "g" ||
          category === "l") && (
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <Label className="text-xs font-bold">Anzahl</Label>
              <input
                type="number"
                min="0"
                step={category === "stk" ? "1" : "0.1"}
                value={rawQty || ""}
                onChange={handleNumberChange(setRawQty, "quantity")}
                onBlur={onBlurSave ? flushAll : undefined}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">Preis/{unitLabel}</Label>
              <input
                type="number"
                min="0"
                step="0.05"
                value={unitPrice || ""}
                onChange={handleNumberChange(setUnitPrice, "unitPrice")}
                onBlur={onBlurSave ? flushAll : undefined}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className="text-xs font-bold">Betrag</Label>
              <div className="h-9 flex items-center text-sm font-medium">
                {formatCHF(totalPrice)}
              </div>
            </div>
          </div>
        )}

        {/* chf (flat): Betrag */}
        {category === "chf" && (
          <div className="max-w-xs">
            <Label className="text-xs font-bold">Betrag (CHF)</Label>
            <input
              type="number"
              min="0"
              step="0.05"
              value={unitPrice || ""}
              onChange={handleNumberChange(setUnitPrice, "unitPrice")}
              onBlur={onBlurSave ? flushAll : undefined}
              className={INPUT_CLS}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Inline row: Service / Diverses (multi-row add/remove)
// ---------------------------------------------------------------------------

export function ServiceArticleRow({
  item,
  index,
  callbacks,
  onBlurSave,
}: {
  item: LocalMaterialItem
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const [description, setDescription] = useState(
    item.details.serviceDescription ?? item.description ?? "",
  )
  const [cost, setCost] = useState(item.details.serviceCost ?? item.details.totalPrice ?? 0)

  const doUpdate = (desc: string, c: number) => {
    callbacks.updateItem(item.id, {
      ...item,
      description: desc,
      details: {
        category: "chf",
        quantity: 1,
        unitPrice: c,
        totalPrice: c,
        serviceDescription: desc,
        serviceCost: c,
      },
    })
  }

  return (
    <Card className="bg-muted/30">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold">Artikel {index + 1}</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => callbacks.removeItem(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-bold">Bezogene Leistungen</Label>
            <input
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                if (!onBlurSave) doUpdate(e.target.value, cost)
              }}
              onBlur={onBlurSave ? () => doUpdate(description, cost) : undefined}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <Label className="text-xs font-bold">Kosten (CHF)</Label>
            <input
              type="number"
              min="0"
              step="0.50"
              value={cost || ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value) || 0
                setCost(v)
                if (!onBlurSave) doUpdate(description, v)
              }}
              onBlur={onBlurSave ? () => doUpdate(description, cost) : undefined}
              className={INPUT_CLS}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Full workshop section (combines all inline forms for one workshop)
// ---------------------------------------------------------------------------

export function WorkshopInlineSection({
  workshopId,
  workshop,
  config,
  localItems,
  existingItems,
  callbacks,
  onBlurSave,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  config: PricingConfig
  localItems: LocalMaterialItem[]
  existingItems: RawMaterialDoc[]
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  // Categorize local items by machine section
  const findMachineItem = (machineLabel: string) =>
    localItems.find(
      (i) =>
        i.type === "machine_hours" &&
        i.description === machineLabel &&
        i.details.category === "h",
    )

  const getSandblastingItems = (machineLabel: string) =>
    localItems.filter(
      (i) =>
        i.type === "machine_hours" &&
        i.description === machineLabel &&
        i.details.category === "obj",
    )

  const get3DPrintItems = (machineLabel: string) =>
    localItems.filter(
      (i) =>
        i.type === "machine_hours" &&
        i.description === machineLabel &&
        i.details.category === "g",
    )

  const materialItems = localItems.filter((i) => i.type === "material")
  const serviceItems = localItems.filter((i) => i.type === "service")

  // Totals
  const localTotal = localItems.reduce((s, i) => s + (i.details.totalPrice ?? 0), 0)
  const existingTotal = existingItems.reduce((s, i) => s + (i.details?.totalPrice ?? 0), 0)
  const wsTotal = localTotal + existingTotal

  // Add helpers
  const addSandblasting = (machine: MachineConfig) => {
    callbacks.addItem({
      id: crypto.randomUUID(),
      description: machine.label,
      workshop: workshopId,
      type: "machine_hours",
      details: {
        category: "obj",
        quantity: 1,
        objectSize: "klein",
        unitPrice: machine.objectSizePrices?.klein ?? 0,
        totalPrice: machine.objectSizePrices?.klein ?? 0,
      },
    })
  }

  const add3DPrint = (machine: MachineConfig) => {
    const defaultMat =
      (Object.keys(machine.materialPrices ?? {}) as PrintMaterial[])[0] ?? "PLA"
    callbacks.addItem({
      id: crypto.randomUUID(),
      description: machine.label,
      workshop: workshopId,
      type: "machine_hours",
      details: {
        category: "g",
        quantity: 0,
        weight_g: 0,
        materialType: defaultMat,
        unitPrice: machine.materialPrices?.[defaultMat] ?? 0,
        totalPrice: 0,
      },
    })
  }

  const addMaterial = () => {
    callbacks.addItem({
      id: crypto.randomUUID(),
      description: "",
      workshop: workshopId,
      type: "material",
      details: {},
    })
  }

  const addService = () => {
    callbacks.addItem({
      id: crypto.randomUUID(),
      description: "",
      workshop: workshopId,
      type: "service",
      details: {
        category: "chf",
        quantity: 1,
        unitPrice: 0,
        totalPrice: 0,
        serviceDescription: "",
        serviceCost: 0,
      },
    })
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4">
        {workshop.label}
      </h2>

      {/* Existing Firestore items (read-only, for logged-in users in checkout) */}
      {existingItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-muted-foreground">
            Bereits erfasst
          </h3>
          {existingItems.map((ei) => (
            <div
              key={ei.id}
              className="flex justify-between text-sm py-1 border-b border-dashed"
            >
              <span>{ei.description}</span>
              <span className="font-medium">
                {formatCHF(ei.details?.totalPrice ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Machine sections */}
      {workshop.machines.map((machine) => {
        if (machine.pricingType === "objectSize") {
          const items = getSandblastingItems(machine.label)
          return (
            <div key={machine.id} className="space-y-3">
              <h3 className="text-sm font-bold">Nutzung {machine.label}</h3>
              {items.map((item, i) => (
                <SandblastingRow
                  key={item.id}
                  item={item}
                  machine={machine}
                  config={config}
                  index={i}
                  callbacks={callbacks}
                  onBlurSave={onBlurSave}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                className="border-cog-teal text-cog-teal hover:bg-cog-teal-light"
                onClick={() => addSandblasting(machine)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Objekt hinzufügen
              </Button>
            </div>
          )
        }

        if (machine.pricingType === "3dprint") {
          const items = get3DPrintItems(machine.label)
          return (
            <div key={machine.id} className="space-y-3">
              <h3 className="text-sm font-bold">Nutzung {machine.label}</h3>
              {items.map((item, i) => (
                <ThreeDPrintRow
                  key={item.id}
                  item={item}
                  machine={machine}
                  index={i}
                  callbacks={callbacks}
                  onBlurSave={onBlurSave}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                className="border-cog-teal text-cog-teal hover:bg-cog-teal-light"
                onClick={() => add3DPrint(machine)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Objekt hinzufügen
              </Button>
            </div>
          )
        }

        // Hourly machine — always show inline row
        return (
          <MachineHoursRow
            key={machine.id}
            machine={machine}
            workshopId={workshopId}
            config={config}
            existingItem={findMachineItem(machine.label)}
            callbacks={callbacks}
            onBlurSave={onBlurSave}
          />
        )
      })}

      {/* Material section */}
      {workshop.materialCategories.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold">Materialbezug {workshop.label}</h3>
          {materialItems.map((item, i) => (
            <MaterialArticleRow
              key={item.id}
              item={item}
              categories={workshop.materialCategories}
              config={config}
              index={i}
              callbacks={callbacks}
              onBlurSave={onBlurSave}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="border-cog-teal text-cog-teal hover:bg-cog-teal-light"
            onClick={addMaterial}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Artikel hinzufügen
          </Button>
        </div>
      )}

      {/* Service / Diverses section */}
      {workshop.hasServiceItems && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold">Diverses {workshop.label}</h3>
          {serviceItems.map((item, i) => (
            <ServiceArticleRow
              key={item.id}
              item={item}
              index={i}
              callbacks={callbacks}
              onBlurSave={onBlurSave}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="border-cog-teal text-cog-teal hover:bg-cog-teal-light"
            onClick={addService}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Artikel hinzufügen
          </Button>
        </div>
      )}

      {/* Workshop subtotal */}
      <div className="flex justify-between font-bold text-sm pt-2 border-t">
        <span>Zwischentotal {workshop.label}</span>
        <span>{formatCHF(wsTotal)}</span>
      </div>
    </div>
  )
}
