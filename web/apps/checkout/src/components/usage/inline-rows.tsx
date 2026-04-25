// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect, Fragment } from "react"
import { Label } from "@modules/components/ui/label"
import { formatCHF } from "@modules/lib/format"
import { Plus, XCircle, Search, ChevronDown, ChevronRight } from "lucide-react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@modules/components/ui/tooltip"
import { useCollection } from "@modules/lib/firestore"
import { where } from "firebase/firestore"
import { checkoutItemRef } from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import type {
  PricingConfig,
  WorkshopId,
  WorkshopConfig,
  CatalogItem,
  DiscountLevel,
  PricingModel,
} from "@modules/lib/workshop-config"
import { getUnitLabel, getShortUnit } from "@modules/lib/workshop-config"
import type { ItemErrors } from "@/components/checkout/validation"

/** Shape of a checkout item for inline editing */
export interface CheckoutItemLocal {
  id: string
  workshop: string
  description: string
  origin: "nfc" | "manual" | "qr"
  catalogId: string | null
  pricingModel: PricingModel | null
  quantity: number
  // For `pricingModel === "sla"` this is CHF per liter of resin, already
  // resolved for the current user's discount level.
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

// --- Error badge for item validation (absolutely positioned to avoid layout shift) ---
function ItemError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <span className="absolute left-0 top-full mt-0.5 whitespace-nowrap px-2 py-0.5 text-xs text-white bg-[#cc2a24] rounded-sm">
      {message}
    </span>
  )
}

const INPUT_ERR_CLS =
  "flex h-9 w-full rounded-none border border-[#cc2a24] bg-background px-3 py-1 text-sm outline-none focus:border-[#cc2a24]"

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
  priceError,
  priceErrorMessage,
}: {
  unitLabel: string
  unitPrice: number
  total: number
  editablePrice?: boolean
  onPriceChange?: (v: number) => void
  onPriceBlur?: () => void
  priceError?: boolean
  priceErrorMessage?: string
}) {
  return (
    <>
      <div className="w-20 sm:w-24 shrink-0 text-right relative">
        <Label className="text-xs font-bold">{unitLabel}</Label>
        {editablePrice ? (
          <input
            type="number"
            min="0"
            step="any"
            value={unitPrice || ""}
            onChange={(e) => onPriceChange?.(Math.max(0, parseFloat(e.target.value) || 0))}
            onBlur={onPriceBlur}
            className={(priceError ? INPUT_ERR_CLS : INPUT_CLS) + " text-right"}
          />
        ) : (
          <div className="h-9 flex items-center justify-end text-sm">
            {formatCHF(unitPrice)}
          </div>
        )}
        <ItemError message={priceErrorMessage} />
      </div>
      <div className="w-20 sm:w-24 shrink-0 text-right">
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
  discountLevel,
  index,
  callbacks,
  onBlurSave,
  error,
}: {
  item: CheckoutItemLocal
  catalogEntry?: CatalogItem
  config: PricingConfig
  // Only used for SLA rows today, to look up the globally-configured
  // per-layer price at the user's discount level. Other pricing models
  // already have their price resolved onto `item.unitPrice` at add time.
  discountLevel?: DiscountLevel
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
  error?: ItemErrors
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
          error={error}
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
          error={error}
        />
      )
    case "sla":
      return (
        <SlaItemRow
          item={item}
          layerPrice={
            config.slaLayerPrice?.[discountLevel ?? "none"] ??
            config.slaLayerPrice?.none ??
            0
          }
          index={index}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
          error={error}
        />
      )
    case "direct":
      return (
        <DirectItemRow
          item={item}
          index={index}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
          error={error}
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
          error={error}
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
  error,
}: {
  item: CheckoutItemLocal
  config: PricingConfig
  pricingModel: PricingModel
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
  error?: ItemErrors
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

  const hasError = error && (error.quantity || error.price)

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}${hasError ? " bg-[#fce4e4]" : ""}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className={`flex flex-wrap items-end gap-x-3 mt-2${hasError ? " gap-y-8 pb-5" : " gap-y-3"}`}>
        <div className="w-24 sm:w-28 relative">
          <Label className="text-xs font-bold">Anzahl ({displayUnit})</Label>
          <input
            type="number"
            min="0"
            step="any"
            value={rawQty || ""}
            onChange={(e) => {
              const v = Math.max(0, parseFloat(e.target.value) || 0)
              setRawQty(v)
              if (!onBlurSave) doUpdate(v, needsUserPrice ? localUnitPrice : undefined)
            }}
            onBlur={onBlurSave ? () => doUpdate(rawQty, needsUserPrice ? localUnitPrice : undefined) : undefined}
            className={error?.quantity ? INPUT_ERR_CLS : INPUT_CLS}
          />
          <ItemError message={error?.quantity} />
        </div>
        <div className="ml-auto flex items-end gap-3">
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
          priceError={!!error?.price}
          priceErrorMessage={error?.price}
        />
        </div>
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
  error,
}: {
  item: CheckoutItemLocal
  config: PricingConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
  error?: ItemErrors
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

  const hasError = error && (error.quantity || error.price)

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}${hasError ? " bg-[#fce4e4]" : ""}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className={`flex flex-wrap items-end gap-x-3 mt-2${hasError ? " gap-y-8 pb-5" : " gap-y-3"}`}>
        <div className="w-20 sm:w-24 relative">
          <Label className="text-xs font-bold">Länge (cm)</Label>
          <input
            type="number"
            min="0"
            step="any"
            value={lengthCm || ""}
            onChange={(e) => {
              const v = Math.max(0, parseFloat(e.target.value) || 0)
              setLengthCm(v)
              if (!onBlurSave) doUpdate(v, widthCm)
            }}
            onBlur={onBlurSave ? () => doUpdate(lengthCm, widthCm) : undefined}
            className={error?.quantity ? INPUT_ERR_CLS : INPUT_CLS}
          />
          <ItemError message={error?.quantity} />
        </div>
        <div className="w-20 sm:w-24">
          <Label className="text-xs font-bold">Breite (cm)</Label>
          <input
            type="number"
            min="0"
            step="any"
            value={widthCm || ""}
            onChange={(e) => {
              const v = Math.max(0, parseFloat(e.target.value) || 0)
              setWidthCm(v)
              if (!onBlurSave) doUpdate(lengthCm, v)
            }}
            onBlur={onBlurSave ? () => doUpdate(lengthCm, widthCm) : undefined}
            className={error?.quantity ? INPUT_ERR_CLS : INPUT_CLS}
          />
        </div>
        <div className="w-14 sm:w-16">
          <Label className="text-xs font-bold">{getUnitLabel(config, "area")}</Label>
          <div className="h-9 flex items-center text-sm">{computedM2.toFixed(2)}</div>
        </div>
        <div className="ml-auto flex items-end gap-3">
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
          priceError={!!error?.price}
          priceErrorMessage={error?.price}
        />
        </div>
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
  error,
}: {
  item: CheckoutItemLocal
  config: PricingConfig
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
  error?: ItemErrors
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

  const hasError = error && (error.quantity || error.price)

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}${hasError ? " bg-[#fce4e4]" : ""}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className={`flex flex-wrap items-end gap-x-3 mt-2${hasError ? " gap-y-8 pb-5" : " gap-y-3"}`}>
        <div className="w-24 sm:w-28 relative">
          <Label className="text-xs font-bold">Länge (cm)</Label>
          <input
            type="number"
            min="0"
            step="any"
            value={lengthCm || ""}
            onChange={(e) => {
              const v = Math.max(0, parseFloat(e.target.value) || 0)
              setLengthCm(v)
              if (!onBlurSave) doUpdate(v)
            }}
            onBlur={onBlurSave ? () => doUpdate(lengthCm) : undefined}
            className={error?.quantity ? INPUT_ERR_CLS : INPUT_CLS}
          />
          <ItemError message={error?.quantity} />
        </div>
        <div className="ml-auto flex items-end gap-3">
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
          priceError={!!error?.price}
          priceErrorMessage={error?.price}
        />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SLA resin print item (two-axis price: resin volume ml × CHF/l + layers × CHF/layer)
// ---------------------------------------------------------------------------

function SlaItemRow({
  item,
  layerPrice,
  index,
  callbacks,
  onBlurSave,
  error,
}: {
  item: CheckoutItemLocal
  // Resolved CHF-per-layer for the current discount level. SLA layer cost is
  // hardware-driven and constant across resin types, so it lives in
  // `PricingConfig.slaLayerPrice` rather than on each catalog entry.
  layerPrice: number
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
  error?: ItemErrors
}) {
  const formResin = item.formInputs?.[0]?.quantity ?? 0
  const formLayers = item.formInputs?.[1]?.quantity ?? 0
  const [resinMl, setResinMl] = useState(formResin)
  const [layers, setLayers] = useState(formLayers)

  // For SLA, unitPrice is CHF/l of resin (resolved at add time).
  const resinPricePerLiter = item.unitPrice

  const computeTotal = (ml: number, lyr: number) =>
    Math.round(
      ((ml / 1000) * resinPricePerLiter + lyr * layerPrice) * 100,
    ) / 100

  const doUpdate = (ml: number, lyr: number) => {
    callbacks.updateItem(item.id, {
      ...item,
      quantity: 1,
      totalPrice: computeTotal(ml, lyr),
      formInputs: [
        { quantity: ml, unit: "ml" },
        { quantity: lyr, unit: "layers" },
      ],
    })
  }

  const hasError = error && (error.quantity || error.price)

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}${hasError ? " bg-[#fce4e4]" : ""}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className={`flex flex-wrap items-end gap-x-3 mt-2${hasError ? " gap-y-8 pb-5" : " gap-y-3"}`}>
        <div className="w-24 sm:w-28 relative">
          <Label className="text-xs font-bold">Resin (ml)</Label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={resinMl || ""}
            onChange={(e) => {
              const v = Math.max(0, parseFloat(e.target.value) || 0)
              setResinMl(v)
              if (!onBlurSave) doUpdate(v, layers)
            }}
            onBlur={onBlurSave ? () => doUpdate(resinMl, layers) : undefined}
            className={error?.quantity ? INPUT_ERR_CLS : INPUT_CLS}
          />
          <ItemError message={error?.quantity} />
        </div>
        <div className="w-24 sm:w-28">
          <Label className="text-xs font-bold">Layer</Label>
          <input
            type="number"
            min="0"
            step="1"
            value={layers || ""}
            onChange={(e) => {
              // Layer count is an integer counter — clamp to non-negative int.
              const v = Math.max(0, Math.floor(parseFloat(e.target.value) || 0))
              setLayers(v)
              if (!onBlurSave) doUpdate(resinMl, v)
            }}
            onBlur={onBlurSave ? () => doUpdate(resinMl, layers) : undefined}
            className={error?.quantity ? INPUT_ERR_CLS : INPUT_CLS}
          />
        </div>
        <div className="ml-auto flex items-end gap-3">
          {/* SLA has two price axes — show both so users can see the full
              pricing signal: resin (dominant) + layer cost. */}
          <div className="w-32 sm:w-40 shrink-0 text-right">
            <Label className="text-xs font-bold">Preis/Einheit</Label>
            <div className="min-h-9 flex flex-col items-end justify-center text-sm leading-tight">
              <span>{`${resinPricePerLiter} CHF/l`}</span>
              <span>{`${layerPrice} CHF/Layer`}</span>
            </div>
          </div>
          <div className="w-20 sm:w-24 shrink-0 text-right">
            <Label className="text-xs font-bold">Betrag</Label>
            <div className="h-9 flex items-center justify-end text-sm font-bold">
              {formatCHF(computeTotal(resinMl, layers))}
            </div>
          </div>
        </div>
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
  error,
}: {
  item: CheckoutItemLocal
  index: number
  callbacks: ItemCallbacks
  onBlurSave?: boolean
  error?: ItemErrors
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

  const hasError = error && (error.description || error.price)

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}${hasError ? " bg-[#fce4e4]" : ""}`}>
      <ItemHeader
        label={`Artikel ${index + 1}: ${item.description || "Pauschal"}`}
        onRemove={() => callbacks.removeItem(item.id)}
      />
      <div className={`flex flex-wrap items-end gap-x-3 mt-2${hasError ? " gap-y-8 pb-5" : " gap-y-3"}`}>
        <div className="flex-1 min-w-0 relative">
          <Label className="text-xs font-bold">Bezogene Leistungen</Label>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              if (!onBlurSave) doUpdate(e.target.value, cost)
            }}
            onBlur={onBlurSave ? () => doUpdate(description, cost) : undefined}
            placeholder="Was hast du gebraucht?"
            className={error?.description ? INPUT_ERR_CLS : INPUT_CLS}
          />
          <ItemError message={error?.description} />
        </div>
        <div className="w-24 shrink-0 relative">
          <Label className="text-xs font-bold">Kosten (CHF)</Label>
          <input
            type="number"
            min="0"
            step="any"
            value={cost || ""}
            onChange={(e) => {
              const v = Math.max(0, parseFloat(e.target.value) || 0)
              setCost(v)
              if (!onBlurSave) doUpdate(description, v)
            }}
            onBlur={onBlurSave ? () => doUpdate(description, cost) : undefined}
            className={error?.price ? INPUT_ERR_CLS : INPUT_CLS}
          />
          <ItemError message={error?.price} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NFC machine usage row (read-only, styled like other item rows)
// ---------------------------------------------------------------------------

interface UsageMachineDoc {
  machine?: { id: string }
  startTime?: { toDate(): Date }
  endTime?: { toDate(): Date }
  checkoutItemRef?: unknown
}

function NfcUsageDetails({
  checkoutId,
  itemId,
}: {
  checkoutId: string
  itemId: string
}) {
  const db = useDb()
  const ref = checkoutItemRef(db, checkoutId, itemId)
  const { data, loading } = useCollection<UsageMachineDoc>(
    "usage_machine",
    where("checkoutItemRef", "==", ref),
  )
  // Query machine collection directly (no LookupProvider dependency)
  const { data: machinesDocs } = useCollection<{ name: string }>("machine")
  const machines = new Map(machinesDocs.map((d) => [d.id, d.name]))

  if (loading) return <div className="text-xs text-muted-foreground py-1">Laden...</div>
  if (data.length === 0) return <div className="text-xs text-muted-foreground py-1">Keine Maschinennutzungen</div>

  // Group by date: today vs older dates
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

  const grouped = new Map<string, { label: string | null; entries: typeof data }>()
  for (const rec of data) {
    const start = rec.startTime?.toDate()
    if (!start) continue
    const key = `${start.getFullYear()}-${String(start.getMonth()).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`
    const isToday = key === todayKey
    if (!grouped.has(key)) {
      grouped.set(key, {
        label: isToday ? null : start.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" }),
        entries: [],
      })
    }
    grouped.get(key)!.entries.push(rec)
  }

  // Sort groups by date descending (today first), entries by start time
  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a))
  for (const [, group] of sortedGroups) {
    group.entries.sort((a, b) => {
      const ta = a.startTime?.toDate().getTime() ?? 0
      const tb = b.startTime?.toDate().getTime() ?? 0
      return ta - tb
    })
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground/70">
          <th className="text-left font-medium pb-1 pr-4">Maschine</th>
          <th className="text-right font-medium pb-1 pr-2">Dauer</th>
          <th className="text-right font-medium pb-1">Start</th>
        </tr>
      </thead>
      <tbody>
        {sortedGroups.map(([key, group]) => (
          <Fragment key={key}>
            {group.label && (
              <tr>
                <td colSpan={3} className="pt-2 pb-0.5 font-bold text-muted-foreground">
                  {group.label}
                </td>
              </tr>
            )}
            {group.entries.map((rec) => {
              const start = rec.startTime?.toDate()
              const end = rec.endTime?.toDate()
              const machineName = rec.machine ? (machines.get(rec.machine.id) ?? rec.machine.id) : "–"
              const durationMin = start && end
                ? Math.round((end.getTime() - start.getTime()) / 60000)
                : null
              const timeStr = start
                ? start.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
                : ""
              return (
                <tr key={rec.id} className="text-muted-foreground">
                  <td className="py-0.5 pr-4">{machineName}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">
                    {durationMin != null ? `${durationMin} min` : "aktiv"}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{timeStr}</td>
                </tr>
              )
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

export function NfcMachineItemRow({
  item,
  index,
  checkoutId,
}: {
  item: CheckoutItemLocal
  index: number
  checkoutId: string | null
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const minutes = Math.round(item.quantity * 60)

  return (
    <div className={`pl-8 pr-4 py-3 ${rowBg(index)}`}>
      {/* Header with grayed-out remove icon + tooltip */}
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="-ml-6 shrink-0 text-muted-foreground/40 cursor-default">
                <XCircle className="h-4 w-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Per NFC erfasst — nicht entfernbar
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <h4 className="text-sm font-bold">{item.description}</h4>
      </div>

      {/* Quantity + price row */}
      <div className="flex flex-wrap items-end gap-3 mt-2">
        <div className="w-24 sm:w-28">
          <Label className="text-xs font-bold">Dauer</Label>
          <div className="h-9 flex items-center text-sm">
            {`${minutes} min`}
          </div>
        </div>
        <div className="ml-auto flex items-end gap-3">
        <PriceColumns
          unitLabel="Preis/h"
          unitPrice={item.unitPrice}
          total={item.totalPrice}
        />
        </div>
      </div>

      {/* Expandable details */}
      {checkoutId && (
        <div className="mt-3 border-t border-dashed pt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Einzelne Nutzungen
          </button>
          {detailsOpen && (
            <div className="mt-1.5 pl-4 pr-2">
              <NfcUsageDetails checkoutId={checkoutId} itemId={item.id} />
            </div>
          )}
        </div>
      )}
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
    // Scroll the container into view so the dropdown is visible
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
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
  const matches = (q
    ? catalogItems.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code?.toLowerCase().includes(q),
      )
    : catalogItems
  ).sort((a, b) => a.name.localeCompare(b.name, "de"))

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
  checkoutId,
  itemErrors,
  sectionRef,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  config: PricingConfig
  items: CheckoutItemLocal[]
  catalogItems: CatalogItem[]
  callbacks: ItemCallbacks
  discountLevel: DiscountLevel
  onBlurSave?: boolean
  checkoutId?: string | null
  itemErrors?: Record<string, ItemErrors>
  sectionRef?: (el: HTMLDivElement | null) => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)

  // NFC items first, then manual — continuous indexing
  const nfcItems = items.filter((i) => i.origin === "nfc")
  const manualItems = items.filter((i) => i.origin !== "nfc")

  const wsTotal = items.reduce((s, i) => s + i.totalPrice, 0)

  return (
    <div ref={sectionRef} className="space-y-2">
      <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4">
        {workshop.label}
      </h2>

      {/* NFC machine items (read-only, same style as manual items) */}
      {nfcItems.map((item, i) => (
        <NfcMachineItemRow
          key={item.id}
          item={item}
          index={i}
          checkoutId={checkoutId ?? null}
        />
      ))}

      {/* Manual items (editable, index continues after NFC items) */}
      {manualItems.map((item, i) => (
        <CatalogItemRow
          key={item.id}
          item={item}
          catalogEntry={catalogItems.find((c) => c.id === item.catalogId)}
          config={config}
          discountLevel={discountLevel}
          index={nfcItems.length + i}
          callbacks={callbacks}
          onBlurSave={onBlurSave}
          error={itemErrors?.[item.id]}
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
