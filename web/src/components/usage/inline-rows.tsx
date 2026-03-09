// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect } from "react"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import { Plus, XCircle, Search } from "lucide-react"
import type {
  PricingConfig,
  WorkshopId,
  WorkshopConfig,
  CatalogItem,
  DiscountLevel,
  PricingModel,
} from "@/lib/workshop-config"
import { getUnitLabel } from "@/lib/workshop-config"

/** Shape of a checkout item for inline editing */
export interface CheckoutItemLocal {
  id: string
  workshop: string
  description: string
  origin: "nfc" | "manual" | "qr"
  catalogId: string | null
  pricingModel: PricingModel | null
  quantity: number
  unitPrice: number
  totalPrice: number
  formInputs?: { quantity: number; unit: string }[]
}

/** Generic callbacks for adding/updating/removing items */
export interface ItemCallbacks {
  addItem: (item: CheckoutItemLocal) => void
  updateItem: (id: string, item: CheckoutItemLocal) => void
  removeItem: (id: string) => void
}

// --- Shared input styles ---
export const INPUT_CLS =
  "flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
export const SELECT_CLS =
  "flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm"

// --- Row background: alternating gray / white ---
function rowBg(index: number): string {
  return index % 2 === 0 ? "bg-[#f5f5f5]" : "bg-white"
}

// --- Shared row header: ⊗ icon left + label ---
function ItemHeader({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="-ml-6 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <XCircle className="h-4 w-4" />
      </button>
      <h4 className="text-sm font-bold">{label}</h4>
    </div>
  )
}

// --- Price columns (fixed-width, right-aligned, optionally editable) ---
function PriceColumns({
  unitLabel,
  unitPrice,
  total,
  editablePrice,
  onPriceChange,
  onPriceBlur,
}: {
  unitLabel: string
  unitPrice: number
  total: number
  editablePrice?: boolean
  onPriceChange?: (v: number) => void
  onPriceBlur?: () => void
}) {
  return (
    <>
      <div className="w-24 shrink-0 text-right">
        <Label className="text-xs font-bold">{unitLabel}</Label>
        {editablePrice ? (
          <input
            type="number"
            min="0"
            step="0.05"
            value={unitPrice || ""}
            onChange={(e) => onPriceChange?.(parseFloat(e.target.value) || 0)}
            onBlur={onPriceBlur}
            className={INPUT_CLS + " text-right"}
          />
        ) : (
          <div className="h-9 flex items-center justify-end text-sm">
            {formatCHF(unitPrice)}
          </div>
        )}
      </div>
      <div className="w-24 shrink-0 text-right">
        <Label className="text-xs font-bold">Betrag</Label>
        <div className="h-9 flex items-center justify-end text-sm font-bold">
          {formatCHF(total)}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Inline row: Catalog item (handles all pricing models)
// ---------------------------------------------------------------------------

export function CatalogItemRow({
  item,
  catalogEntry,
  config,
  index,
  callbacks,
  onBlurSave,
}: {
  item: CheckoutItemLocal
  catalogEntry?: CatalogItem
  config: PricingConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const pricingModel = catalogEntry?.pricingModel ?? item.pricingModel ?? "count"

  switch (pricingModel) {
    case "area":
      return (
        <AreaItemRow
          item={item}
          config={config}
          index={index}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
        />
      )
    case "length":
      return (
        <LengthItemRow
          item={item}
          config={config}
          index={index}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
        />
      )
    case "direct":
      return (
        <DirectItemRow
          item={item}
          index={index}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
        />
      )
    default:
      return (
        <SimpleItemRow
          item={item}
          config={config}
          pricingModel={pricingModel}
          index={index}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
        />
      )
  }
}

// ---------------------------------------------------------------------------
// Simple quantity item (count, weight, time)
// ---------------------------------------------------------------------------

function SimpleItemRow({
  item,
  config,
  pricingModel,
  index,
  callbacks,
  onBlurSave,
}: {
  item: CheckoutItemLocal
  config: PricingConfig
  pricingModel: PricingModel
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const isWeight = pricingModel === "weight"
  const isTime = pricingModel === "time"
  const displayUnit = isWeight ? "g" : isTime ? "min" : getUnitLabel(config, pricingModel)

  const formInput = item.formInputs?.[0]
  const [rawQty, setRawQty] = useState(
    formInput?.quantity ?? (isWeight ? item.quantity * 1000 : isTime ? item.quantity * 60 : item.quantity),
  )

  const convertToBase = (raw: number): number => {
    if (isWeight) return raw / 1000
    if (isTime) return raw / 60
    return raw
  }

  const needsUserPrice = !item.catalogId
  const [localUnitPrice, setLocalUnitPrice] = useState(item.unitPrice)
  const effectivePrice = needsUserPrice ? localUnitPrice : item.unitPrice

  const doUpdate = (raw: number, up?: number) => {
    const baseQty = convertToBase(raw)
    const price = up ?? effectivePrice
    const tp = Math.round(baseQty * price * 100) / 100
    callbacks.updateItem(item.id, {
      ...item,
      quantity: baseQty,
      unitPrice: needsUserPrice ? price : item.unitPrice,
      totalPrice: tp,
      formInputs: [{ quantity: raw, unit: displayUnit }],
    })
  }

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className="flex items-end gap-3 mt-2">
        <div className="w-28">
          <Label className="text-xs font-bold">Anzahl ({displayUnit})</Label>
          <input
            type="number"
            min="0"
            step={pricingModel === "count" ? "1" : "0.1"}
            value={rawQty || ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              setRawQty(v)
              if (!onBlurSave) doUpdate(v, needsUserPrice ? localUnitPrice : undefined)
            }}
            onBlur={onBlurSave ? () => doUpdate(rawQty, needsUserPrice ? localUnitPrice : undefined) : undefined}
            className={INPUT_CLS}
          />
        </div>
        <div className="flex-1" />
        <PriceColumns
          unitLabel={`Preis/${getUnitLabel(config, pricingModel)}`}
          unitPrice={effectivePrice}
          total={convertToBase(rawQty) * effectivePrice}
          editablePrice={needsUserPrice}
          onPriceChange={(v) => {
            setLocalUnitPrice(v)
            if (!onBlurSave) doUpdate(rawQty, v)
          }}
          onPriceBlur={onBlurSave ? () => doUpdate(rawQty, localUnitPrice) : undefined}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Area item (m²: length × width in cm → m²)
// ---------------------------------------------------------------------------

function AreaItemRow({
  item,
  config,
  index,
  callbacks,
  onBlurSave,
}: {
  item: CheckoutItemLocal
  config: PricingConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const formL = item.formInputs?.[0]?.quantity ?? 0
  const formW = item.formInputs?.[1]?.quantity ?? 0
  const [lengthCm, setLengthCm] = useState(formL)
  const [widthCm, setWidthCm] = useState(formW)

  const computedM2 = (lengthCm / 100) * (widthCm / 100)

  const needsUserPrice = !item.catalogId
  const [localUnitPrice, setLocalUnitPrice] = useState(item.unitPrice)
  const effectivePrice = needsUserPrice ? localUnitPrice : item.unitPrice

  const doUpdate = (l: number, w: number, up?: number) => {
    const m2 = (l / 100) * (w / 100)
    const price = up ?? effectivePrice
    const tp = Math.round(m2 * price * 100) / 100
    callbacks.updateItem(item.id, {
      ...item,
      quantity: m2,
      unitPrice: needsUserPrice ? price : item.unitPrice,
      totalPrice: tp,
      formInputs: [
        { quantity: l, unit: "cm" },
        { quantity: w, unit: "cm" },
      ],
    })
  }

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className="flex items-end gap-3 mt-2">
        <div className="w-24">
          <Label className="text-xs font-bold">Länge (cm)</Label>
          <input
            type="number"
            min="0"
            step="1"
            value={lengthCm || ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              setLengthCm(v)
              if (!onBlurSave) doUpdate(v, widthCm)
            }}
            onBlur={onBlurSave ? () => doUpdate(lengthCm, widthCm) : undefined}
            className={INPUT_CLS}
          />
        </div>
        <div className="w-24">
          <Label className="text-xs font-bold">Breite (cm)</Label>
          <input
            type="number"
            min="0"
            step="1"
            value={widthCm || ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              setWidthCm(v)
              if (!onBlurSave) doUpdate(lengthCm, v)
            }}
            onBlur={onBlurSave ? () => doUpdate(lengthCm, widthCm) : undefined}
            className={INPUT_CLS}
          />
        </div>
        <div className="w-16">
          <Label className="text-xs font-bold">{getUnitLabel(config, "area")}</Label>
          <div className="h-9 flex items-center text-sm">{computedM2.toFixed(2)}</div>
        </div>
        <div className="flex-1" />
        <PriceColumns
          unitLabel={`Preis/${getUnitLabel(config, "area")}`}
          unitPrice={effectivePrice}
          total={computedM2 * effectivePrice}
          editablePrice={needsUserPrice}
          onPriceChange={(v) => {
            setLocalUnitPrice(v)
            if (!onBlurSave) doUpdate(lengthCm, widthCm, v)
          }}
          onPriceBlur={onBlurSave ? () => doUpdate(lengthCm, widthCm, localUnitPrice) : undefined}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Length item (m: length in cm → m)
// ---------------------------------------------------------------------------

function LengthItemRow({
  item,
  config,
  index,
  callbacks,
  onBlurSave,
}: {
  item: CheckoutItemLocal
  config: PricingConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const formL = item.formInputs?.[0]?.quantity ?? 0
  const [lengthCm, setLengthCm] = useState(formL)

  const needsUserPrice = !item.catalogId
  const [localUnitPrice, setLocalUnitPrice] = useState(item.unitPrice)
  const effectivePrice = needsUserPrice ? localUnitPrice : item.unitPrice

  const doUpdate = (l: number, up?: number) => {
    const meters = l / 100
    const price = up ?? effectivePrice
    const tp = Math.round(meters * price * 100) / 100
    callbacks.updateItem(item.id, {
      ...item,
      quantity: meters,
      unitPrice: needsUserPrice ? price : item.unitPrice,
      totalPrice: tp,
      formInputs: [{ quantity: l, unit: "cm" }],
    })
  }

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className="flex items-end gap-3 mt-2">
        <div className="w-28">
          <Label className="text-xs font-bold">Länge (cm)</Label>
          <input
            type="number"
            min="0"
            step="1"
            value={lengthCm || ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              setLengthCm(v)
              if (!onBlurSave) doUpdate(v)
            }}
            onBlur={onBlurSave ? () => doUpdate(lengthCm) : undefined}
            className={INPUT_CLS}
          />
        </div>
        <div className="flex-1" />
        <PriceColumns
          unitLabel={`Preis/${getUnitLabel(config, "length")}`}
          unitPrice={effectivePrice}
          total={(lengthCm / 100) * effectivePrice}
          editablePrice={needsUserPrice}
          onPriceChange={(v) => {
            setLocalUnitPrice(v)
            if (!onBlurSave) doUpdate(lengthCm, v)
          }}
          onPriceBlur={onBlurSave ? () => doUpdate(lengthCm, localUnitPrice) : undefined}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Direct price item (user enters description + CHF amount)
// ---------------------------------------------------------------------------

function DirectItemRow({
  item,
  index,
  callbacks,
  onBlurSave,
}: {
  item: CheckoutItemLocal
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
}) {
  const [description, setDescription] = useState(item.description)
  const [cost, setCost] = useState(item.totalPrice)

  const doUpdate = (desc: string, c: number) => {
    callbacks.updateItem(item.id, {
      ...item,
      description: desc,
      quantity: 1,
      unitPrice: c,
      totalPrice: c,
    })
  }

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description || "Pauschal"}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className="flex items-end gap-3 mt-2">
        <div className="flex-1">
          <Label className="text-xs font-bold">Bezogene Leistungen</Label>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              if (!onBlurSave) doUpdate(e.target.value, cost)
            }}
            onBlur={onBlurSave ? () => doUpdate(description, cost) : undefined}
            placeholder="Was hast du gebraucht?"
            className={INPUT_CLS}
          />
        </div>
        <div className="w-24 shrink-0">
          <Label className="text-xs font-bold">Kosten (CHF)</Label>
          <input
            type="number"
            min="0"
            step="0.05"
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// NFC machine usage row (read-only display)
// ---------------------------------------------------------------------------

export function NfcMachineItemRow({ item }: { item: CheckoutItemLocal }) {
  return (
    <div className="flex justify-between text-sm py-1 border-b border-dashed last:border-0">
      <span>{item.description}</span>
      <span className="text-muted-foreground">
        {item.quantity > 0 ? `${Math.round(item.quantity * 60)} min` : "Aktiv"}{" "}
        <span className="font-medium ml-2">{formatCHF(item.totalPrice)}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Smart search autocomplete for adding articles
// ---------------------------------------------------------------------------

const FALLBACK_MODELS: { pricingModel: PricingModel; label: string; hint: string }[] = [
  { pricingModel: "direct", label: "Pauschal CHF", hint: "" },
  { pricingModel: "area", label: "m²", hint: "Platten, Massivholz..." },
  { pricingModel: "count", label: "Stk", hint: "Verbrauchsmaterial" },
  { pricingModel: "length", label: "m", hint: "Latten, Rundholz..." },
  { pricingModel: "weight", label: "kg", hint: "3D-Druck, Schüttgut..." },
  { pricingModel: "time", label: "h", hint: "Maschinenzeit" },
]

function AddArticleSearch({
  workshopId,
  catalogItems,
  discountLevel,
  callbacks,
  onClose,
}: {
  workshopId: WorkshopId
  catalogItems: CatalogItem[]
  discountLevel: DiscountLevel
  callbacks: ItemCallbacks
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  const q = query.toLowerCase().trim()
  const matches = q
    ? catalogItems.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code?.toLowerCase().includes(q),
      )
    : catalogItems

  const selectCatalog = (cat: CatalogItem) => {
    const unitPrice = cat.unitPrice[discountLevel] ?? cat.unitPrice.none ?? 0
    callbacks.addItem({
      id: crypto.randomUUID(),
      workshop: workshopId,
      description: cat.name,
      origin: "manual",
      catalogId: cat.id,
      pricingModel: cat.pricingModel,
      quantity: 0,
      unitPrice,
      totalPrice: 0,
    })
    onClose()
  }

  const selectFallback = (pricingModel: PricingModel) => {
    const desc = query.trim()
    callbacks.addItem({
      id: crypto.randomUUID(),
      workshop: workshopId,
      description: desc,
      origin: "manual",
      catalogId: null,
      pricingModel,
      quantity: pricingModel === "direct" ? 1 : 0,
      unitPrice: 0,
      totalPrice: 0,
    })
    onClose()
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 border border-cog-teal rounded-[3px] bg-background px-3 py-1.5">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Material suchen (Name oder Code)..."
          className="flex-1 text-sm outline-none bg-transparent"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose()
          }}
        />
      </div>

      {/* Dropdown */}
      <div className="absolute z-10 left-0 right-0 mt-1 bg-background border border-[#ccc] rounded-[3px] shadow-md max-h-72 overflow-y-auto">
        {/* Catalog matches */}
        {matches.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center justify-between"
            onClick={() => selectCatalog(cat)}
          >
            <div>
              <span className="text-sm">{cat.name}</span>
              {cat.code && (
                <span className="text-xs text-muted-foreground ml-2">
                  #{cat.code}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatCHF(cat.unitPrice[discountLevel] ?? cat.unitPrice.none ?? 0)}/{
                getShortUnit(cat.pricingModel)
              }
            </span>
          </button>
        ))}

        {/* Separator + fallback options */}
        {q.length > 0 && (
          <>
            <div className="px-3 py-1.5 border-t border-[#ddd]">
              <span className="text-xs text-muted-foreground">
                Kein passender Eintrag?
              </span>
            </div>
            {FALLBACK_MODELS.map((fb) => (
              <button
                key={fb.pricingModel}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                onClick={() => selectFallback(fb.pricingModel)}
              >
                <span className="text-sm italic text-muted-foreground">
                  &ldquo;{query.trim()}&rdquo;
                </span>
                <span className="text-xs text-muted-foreground ml-1">
                  ({fb.label}{fb.hint ? `: ${fb.hint}` : ""})
                </span>
              </button>
            ))}
          </>
        )}

        {matches.length === 0 && q.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            Tippe um zu suchen...
          </div>
        )}
      </div>
    </div>
  )
}

function getShortUnit(pm: PricingModel): string {
  switch (pm) {
    case "time": return "h"
    case "area": return "m²"
    case "length": return "m"
    case "count": return "Stk"
    case "weight": return "kg"
    case "direct": return "CHF"
    default: return ""
  }
}

// ---------------------------------------------------------------------------
// Full workshop section (combines all items for one workshop)
// ---------------------------------------------------------------------------

export function WorkshopInlineSection({
  workshopId,
  workshop,
  config,
  items,
  catalogItems,
  callbacks,
  discountLevel,
  onBlurSave,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  config: PricingConfig
  items: CheckoutItemLocal[]
  catalogItems: CatalogItem[]
  callbacks: ItemCallbacks
  discountLevel: DiscountLevel
  onBlurSave?: boolean
}) {
  const [searchOpen, setSearchOpen] = useState(false)

  const nfcItems = items.filter((i) => i.origin === "nfc")
  const manualItems = items.filter((i) => i.origin !== "nfc")

  const wsTotal = items.reduce((s, i) => s + i.totalPrice, 0)

  return (
    <div className="space-y-2">
      <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4">
        {workshop.label}
      </h2>

      {/* NFC machine items (read-only) */}
      {nfcItems.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2">Maschinennutzung (NFC)</h3>
          {nfcItems.map((item) => (
            <NfcMachineItemRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Manual items (editable) */}
      {manualItems.map((item, i) => (
        <CatalogItemRow
          key={item.id}
          item={item}
          catalogEntry={catalogItems.find((c) => c.id === item.catalogId)}
          config={config}
          index={i}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
        />
      ))}

      {/* Add article button / search */}
      {searchOpen ? (
        <AddArticleSearch
          workshopId={workshopId}
          catalogItems={catalogItems}
          discountLevel={discountLevel}
          callbacks={callbacks}
          onClose={() => setSearchOpen(false)}
        />
      ) : (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          onClick={() => setSearchOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Artikel hinzufügen
        </button>
      )}

      {/* Workshop subtotal */}
      <div className="flex justify-between font-bold text-sm pt-2 border-t">
        <span>Zwischentotal {workshop.label}</span>
        <span>{formatCHF(wsTotal)}</span>
      </div>
    </div>
  )
}
