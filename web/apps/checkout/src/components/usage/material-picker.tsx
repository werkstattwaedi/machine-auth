// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useMemo, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@modules/components/ui/sheet"
import { VisuallyHidden } from "radix-ui"
import { Label } from "@modules/components/ui/label"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { formatCHF } from "@modules/lib/format"
import {
  formatUnitPrice,
  formatPricePerCount,
} from "@modules/lib/units"
import { Search, X } from "lucide-react"
import {
  getUnitLabel,
  getShortUnit,
} from "@modules/lib/workshop-config"
import type {
  PricingConfig,
  WorkshopId,
  CatalogItem,
  DiscountLevel,
  PricingModel,
} from "@modules/lib/workshop-config"
import type { CheckoutItemLocal } from "./inline-rows"

const INPUT_CLS =
  "flex h-9 w-full rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"

// Fallback pricing models surfaced when the search has no catalog match.
// Lets the member add ad-hoc materials we don't track in the catalog yet —
// the legacy inline search supported this; the v5 picker has to as well so
// people can finish their checkout without "frag am Empfang" friction.
const FALLBACK_MODELS: ReadonlyArray<{
  pricingModel: PricingModel
  label: string
  hint: string
}> = [
  { pricingModel: "direct", label: "Pauschal CHF", hint: "Beliebiger Posten" },
  { pricingModel: "count", label: "Stk", hint: "Verbrauchsmaterial" },
  { pricingModel: "area", label: "m²", hint: "Platten, Massivholz…" },
  { pricingModel: "length", label: "m", hint: "Latten, Rundholz…" },
  { pricingModel: "weight", label: "kg", hint: "Schüttgut, Filament…" },
  { pricingModel: "time", label: "h", hint: "Maschinenzeit" },
]

interface MaterialPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workshopId: WorkshopId
  workshopLabel: string
  catalogItems: CatalogItem[]
  config: PricingConfig
  discountLevel: DiscountLevel
  /**
   * Called when the user confirms an entry. The picker stays open so the
   * member can add several items in one trip; the host UI handles closing
   * via `onOpenChange`.
   */
  onAdd: (item: CheckoutItemLocal) => void
}

export function MaterialPicker({
  open,
  onOpenChange,
  workshopId,
  workshopLabel,
  catalogItems,
  config,
  discountLevel,
  onAdd,
}: MaterialPickerProps) {
  const isMobile = useIsMobile()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "h-[88%] w-full rounded-t-2xl border-t p-0 sm:max-w-none flex flex-col gap-0"
            : "w-full sm:max-w-md md:max-w-[480px] p-0 flex flex-col gap-0"
        }
        showCloseButton={false}
      >
        <VisuallyHidden.Root>
          <SheetTitle>Material hinzufügen</SheetTitle>
          <SheetDescription>
            Wähle Material für die Werkstatt {workshopLabel}.
          </SheetDescription>
        </VisuallyHidden.Root>

        {isMobile && (
          <div className="flex justify-center pt-2">
            <span className="block h-1 w-10 rounded-full bg-[#d0d0d0]" />
          </div>
        )}

        <PickerHeader
          workshopId={workshopId}
          workshopLabel={workshopLabel}
          onClose={() => onOpenChange(false)}
        >
          {(query, scope) => (
            <PickerBody
              workshopId={workshopId}
              catalogItems={catalogItems}
              config={config}
              discountLevel={discountLevel}
              query={query}
              scope={scope}
              onAdd={onAdd}
            />
          )}
        </PickerHeader>
      </SheetContent>
    </Sheet>
  )
}

function PickerHeader({
  workshopLabel,
  onClose,
  children,
}: {
  workshopId: WorkshopId
  workshopLabel: string
  onClose: () => void
  children: (
    query: string,
    scope: "workshop" | "all",
  ) => React.ReactNode
}) {
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<"workshop" | "all">("workshop")

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-border p-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold">
            Material hinzufügen
          </h2>
          <button
            type="button"
            aria-label="Schliessen"
            className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-border bg-white text-muted-foreground hover:bg-secondary"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex h-10 items-center gap-2 rounded-[3px] border border-[#ccc] bg-background px-3 focus-within:border-cog-teal">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Material suchen…"
            className="flex-1 bg-transparent text-sm outline-none"
            aria-label="Material suchen"
          />
          {query && (
            <button
              type="button"
              aria-label="Suche leeren"
              onClick={() => setQuery("")}
              className="flex h-5 w-5 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-secondary"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterPill
            active={scope === "workshop"}
            onClick={() => setScope("workshop")}
          >
            {workshopLabel}
          </FilterPill>
          <FilterPill active={scope === "all"} onClick={() => setScope("all")}>
            Alle
          </FilterPill>
        </div>
      </div>

      {children(query, scope)}
    </>
  )
}

function PickerBody({
  workshopId,
  catalogItems,
  config,
  discountLevel,
  query,
  scope,
  onAdd,
}: {
  workshopId: WorkshopId
  catalogItems: CatalogItem[]
  config: PricingConfig
  discountLevel: DiscountLevel
  query: string
  scope: "workshop" | "all"
  onAdd: (item: CheckoutItemLocal) => void
}) {
  // At most one row is expanded at a time — either a catalog row or one of
  // the ad-hoc fallback rows. The discriminated union avoids accidental
  // double-expand.
  type Expansion =
    | { kind: "catalog"; id: string }
    | { kind: "fallback"; pricingModel: PricingModel }
    | null
  const [expansion, setExpansion] = useState<Expansion>(null)

  const filtered = useMemo(() => {
    const items =
      scope === "all"
        ? catalogItems
        : catalogItems.filter((c) => c.workshops.includes(workshopId))
    const q = query.trim().toLowerCase()
    const matches = q
      ? items.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.code?.toLowerCase().includes(q),
        )
      : items
    return [...matches].sort((a, b) => a.name.localeCompare(b.name, "de"))
  }, [catalogItems, query, scope, workshopId])

  // Ad-hoc creation needs a description; show the fallback section only
  // when the user has typed something they can use as the item name.
  const trimmedQuery = query.trim()
  const showFallbacks = trimmedQuery.length > 0

  return (
    <div className="flex-1 overflow-y-auto">
      {filtered.length === 0 && !showFallbacks ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Keine Treffer. Such-Begriff anpassen oder einen anderen Filter wählen.
        </div>
      ) : (
        filtered.map((cat) => {
          const isExpanded =
            expansion?.kind === "catalog" && expansion.id === cat.id
          const unitPrice =
            cat.unitPrice[discountLevel] ?? cat.unitPrice.none ?? 0
          return isExpanded ? (
            <ExpandedRow
              key={cat.id}
              catalog={cat}
              config={config}
              unitPrice={unitPrice}
              discountLevel={discountLevel}
              workshopId={workshopId}
              onCancel={() => setExpansion(null)}
              onAdd={(item) => {
                onAdd(item)
                setExpansion(null)
              }}
            />
          ) : (
            <CollapsedRow
              key={cat.id}
              catalog={cat}
              unitPrice={unitPrice}
              onClick={() =>
                setExpansion({ kind: "catalog", id: cat.id })
              }
            />
          )
        })
      )}

      {showFallbacks && (
        <div>
          <div className="border-t border-border bg-background px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Kein passender Eintrag?
          </div>
          {FALLBACK_MODELS.map((fb) => {
            const isExpanded =
              expansion?.kind === "fallback" &&
              expansion.pricingModel === fb.pricingModel
            return isExpanded ? (
              <AdHocExpandedRow
                key={fb.pricingModel}
                pricingModel={fb.pricingModel}
                label={fb.label}
                initialDescription={trimmedQuery}
                workshopId={workshopId}
                config={config}
                onCancel={() => setExpansion(null)}
                onAdd={(item) => {
                  onAdd(item)
                  setExpansion(null)
                }}
              />
            ) : (
              <AdHocCollapsedRow
                key={fb.pricingModel}
                fallback={fb}
                description={trimmedQuery}
                onClick={() =>
                  setExpansion({
                    kind: "fallback",
                    pricingModel: fb.pricingModel,
                  })
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "inline-flex shrink-0 items-center gap-1 rounded-full bg-cog-teal px-3 py-1 text-xs text-white"
          : "inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs text-foreground hover:bg-cog-teal-light"
      }
    >
      {children}
    </button>
  )
}

function CollapsedRow({
  catalog,
  unitPrice,
  onClick,
}: {
  catalog: CatalogItem
  unitPrice: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-cog-teal-light"
    >
      <div className="min-w-0">
        <div className="font-heading text-sm font-semibold truncate">
          {catalog.name}
        </div>
        {catalog.code && (
          <div className="text-xs text-muted-foreground truncate">
            #{catalog.code}
          </div>
        )}
      </div>
      <div className="font-heading text-sm font-semibold tabular-nums whitespace-nowrap">
        {formatCHF(unitPrice)}
        <span className="ml-0.5 font-body text-[11px] font-normal text-muted-foreground">
          /{getShortUnit(catalog.pricingModel)}
        </span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Expanded entry rows — one component per pricing model. Each owns its own
// local form state and converts user input to base units before calling
// `onAdd`. Conversions mirror the editing rows in inline-rows.tsx so a
// material added via the picker has the same on-disk shape as items the
// existing UI created.
// ---------------------------------------------------------------------------

function ExpandedRow({
  catalog,
  config,
  unitPrice,
  discountLevel,
  workshopId,
  onCancel,
  onAdd,
}: {
  catalog: CatalogItem
  config: PricingConfig
  unitPrice: number
  discountLevel: DiscountLevel
  workshopId: WorkshopId
  onCancel: () => void
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const baseItem: Omit<
    CheckoutItemLocal,
    "quantity" | "totalPrice" | "formInputs"
  > = {
    id: "",
    workshop: workshopId,
    description: catalog.name,
    origin: "manual",
    catalogId: catalog.id,
    pricingModel: catalog.pricingModel,
    unitPrice,
  }

  return (
    <div className="border-b border-border bg-secondary px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="font-heading text-sm font-semibold">
            {catalog.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatPriceForCatalog(catalog, config, unitPrice)}
          </div>
        </div>
        <button
          type="button"
          aria-label="Auswahl schliessen"
          onClick={onCancel}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-background"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <PickerEntryForm
        catalog={catalog}
        config={config}
        unitPrice={unitPrice}
        discountLevel={discountLevel}
        baseItem={baseItem}
        onAdd={onAdd}
      />
    </div>
  )
}

function formatPriceForCatalog(
  cat: CatalogItem,
  config: PricingConfig,
  unitPrice: number,
): string {
  if (cat.pricingModel === "sla") {
    // SLA has two price axes; expose the resin per-ml figure as the lead
    // line, the per-layer cost shows up below the layer input.
    return formatUnitPrice(unitPrice, "l", { referenceQuantity: 0.05 })
  }
  return `${formatCHF(unitPrice)} / ${getUnitLabel(config, cat.pricingModel)}`
}

function PickerEntryForm({
  catalog,
  config,
  unitPrice,
  discountLevel,
  baseItem,
  onAdd,
}: {
  catalog: CatalogItem
  config: PricingConfig
  unitPrice: number
  discountLevel: DiscountLevel
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const pm = catalog.pricingModel as PricingModel
  switch (pm) {
    case "area":
      return (
        <AreaForm
          config={config}
          unitPrice={unitPrice}
          baseItem={baseItem}
          onAdd={onAdd}
        />
      )
    case "length":
      return (
        <LengthForm
          config={config}
          unitPrice={unitPrice}
          baseItem={baseItem}
          onAdd={onAdd}
        />
      )
    case "sla":
      return (
        <SlaForm
          config={config}
          unitPrice={unitPrice}
          discountLevel={discountLevel}
          baseItem={baseItem}
          onAdd={onAdd}
        />
      )
    case "direct":
      return <DirectForm baseItem={baseItem} onAdd={onAdd} />
    case "weight":
    case "time":
    case "count":
    default:
      return (
        <SimpleForm
          pricingModel={pm}
          config={config}
          unitPrice={unitPrice}
          baseItem={baseItem}
          onAdd={onAdd}
        />
      )
  }
}

function AddButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-9 rounded-[3px] bg-cog-teal px-4 text-sm font-semibold text-white transition-opacity hover:bg-cog-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
    >
      Hinzufügen
    </button>
  )
}

function LiveTotal({ value }: { value: number }) {
  return (
    <div className="font-heading text-base font-bold tabular-nums text-cog-teal-dark text-right">
      {value > 0 ? formatCHF(value) : "—"}
    </div>
  )
}

function SimpleForm({
  pricingModel,
  config,
  unitPrice,
  baseItem,
  onAdd,
}: {
  pricingModel: PricingModel
  config: PricingConfig
  unitPrice: number
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const isWeight = pricingModel === "weight"
  const isTime = pricingModel === "time"
  const displayUnit = isWeight
    ? "g"
    : isTime
      ? "min"
      : getUnitLabel(config, pricingModel)
  const [raw, setRaw] = useState(0)
  const baseQty = isWeight ? raw / 1000 : isTime ? raw / 60 : raw
  const total = Math.round(baseQty * unitPrice * 100) / 100
  return (
    <FormGrid>
      <FormField label={`Anzahl (${displayUnit})`}>
        <input
          autoFocus
          type="number"
          min="0"
          step="any"
          value={raw || ""}
          onChange={(e) =>
            setRaw(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <div className="hidden sm:block" />
      <LiveTotal value={total} />
      <AddButton
        disabled={baseQty <= 0}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            quantity: baseQty,
            totalPrice: total,
            formInputs: [{ quantity: raw, unit: displayUnit }],
          })
          setRaw(0)
        }}
      />
    </FormGrid>
  )
}

function AreaForm({
  config,
  unitPrice,
  baseItem,
  onAdd,
}: {
  config: PricingConfig
  unitPrice: number
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const [lengthCm, setLengthCm] = useState(0)
  const [widthCm, setWidthCm] = useState(0)
  const m2 = (lengthCm / 100) * (widthCm / 100)
  const total = Math.round(m2 * unitPrice * 100) / 100
  return (
    <FormGrid>
      <FormField label="Länge (cm)">
        <input
          autoFocus
          type="number"
          min="0"
          step="any"
          value={lengthCm || ""}
          onChange={(e) =>
            setLengthCm(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label="Breite (cm)">
        <input
          type="number"
          min="0"
          step="any"
          value={widthCm || ""}
          onChange={(e) =>
            setWidthCm(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label={getUnitLabel(config, "area")}>
        <div className="flex h-9 items-center text-sm tabular-nums">
          {m2.toFixed(2)}
        </div>
      </FormField>
      <LiveTotal value={total} />
      <AddButton
        disabled={m2 <= 0}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            quantity: m2,
            totalPrice: total,
            formInputs: [
              { quantity: lengthCm, unit: "cm" },
              { quantity: widthCm, unit: "cm" },
            ],
          })
          setLengthCm(0)
          setWidthCm(0)
        }}
      />
    </FormGrid>
  )
}

function LengthForm({
  config,
  unitPrice,
  baseItem,
  onAdd,
}: {
  config: PricingConfig
  unitPrice: number
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const [lengthCm, setLengthCm] = useState(0)
  const meters = lengthCm / 100
  const total = Math.round(meters * unitPrice * 100) / 100
  return (
    <FormGrid>
      <FormField label={`Länge (cm)`}>
        <input
          autoFocus
          type="number"
          min="0"
          step="any"
          value={lengthCm || ""}
          onChange={(e) =>
            setLengthCm(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label={getUnitLabel(config, "length")}>
        <div className="flex h-9 items-center text-sm tabular-nums">
          {meters.toFixed(2)}
        </div>
      </FormField>
      <LiveTotal value={total} />
      <AddButton
        disabled={meters <= 0}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            quantity: meters,
            totalPrice: total,
            formInputs: [{ quantity: lengthCm, unit: "cm" }],
          })
          setLengthCm(0)
        }}
      />
    </FormGrid>
  )
}

function SlaForm({
  config,
  unitPrice,
  discountLevel,
  baseItem,
  onAdd,
}: {
  config: PricingConfig
  unitPrice: number
  discountLevel: DiscountLevel
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const [resinMl, setResinMl] = useState(0)
  const [layers, setLayers] = useState(0)
  const layerPrice =
    config.slaLayerPrice?.[discountLevel] ?? config.slaLayerPrice?.none ?? 0
  const total =
    Math.round(((resinMl / 1000) * unitPrice + layers * layerPrice) * 100) /
    100
  return (
    <FormGrid>
      <FormField label="Resin (ml)">
        <input
          autoFocus
          type="number"
          min="0"
          step="0.1"
          value={resinMl || ""}
          onChange={(e) =>
            setResinMl(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label="Layer">
        <input
          type="number"
          min="0"
          step="1"
          value={layers || ""}
          onChange={(e) =>
            setLayers(
              Math.max(0, Math.floor(parseFloat(e.target.value) || 0)),
            )
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label="Preis Layer">
        <div className="flex h-9 items-center text-sm tabular-nums">
          {formatPricePerCount(layerPrice, "Layer")}
        </div>
      </FormField>
      <LiveTotal value={total} />
      <AddButton
        disabled={total <= 0}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            quantity: 1,
            totalPrice: total,
            formInputs: [
              { quantity: resinMl, unit: "ml" },
              { quantity: layers, unit: "layers" },
            ],
          })
          setResinMl(0)
          setLayers(0)
        }}
      />
    </FormGrid>
  )
}

function DirectForm({
  baseItem,
  onAdd,
}: {
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  onAdd: (item: CheckoutItemLocal) => void
}) {
  // The picker keys ExpandedRow on `cat.id`, so each open of a different
  // catalog row mounts a fresh DirectForm and `useState` re-runs with the
  // current name as initial value — no need for a sync effect.
  const [description, setDescription] = useState(baseItem.description)
  const [cost, setCost] = useState(0)
  return (
    <FormGrid>
      <FormField label="Bezogene Leistungen" wide>
        <input
          autoFocus
          value={description}
          placeholder="Was hast du gebraucht?"
          onChange={(e) => setDescription(e.target.value)}
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label="Kosten (CHF)">
        <input
          type="number"
          min="0"
          step="any"
          value={cost || ""}
          onChange={(e) =>
            setCost(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <LiveTotal value={cost} />
      <AddButton
        disabled={cost <= 0 || !description.trim()}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            description: description.trim(),
            quantity: 1,
            unitPrice: cost,
            totalPrice: cost,
          })
          setCost(0)
        }}
      />
    </FormGrid>
  )
}

// ---------------------------------------------------------------------------
// Ad-hoc rows — when the catalog has no match, the member can still add an
// item by typing a description and picking a pricing model. Mirrors the
// legacy AddArticleSearch fallback flow but with the v5 expanding-row UX.
// ---------------------------------------------------------------------------

function AdHocCollapsedRow({
  fallback,
  description,
  onClick,
}: {
  fallback: { pricingModel: PricingModel; label: string; hint: string }
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-cog-teal-light"
    >
      <div className="min-w-0">
        <div className="font-heading text-sm font-semibold truncate">
          „{description}"
        </div>
        {fallback.hint && (
          <div className="text-xs text-muted-foreground truncate">
            {fallback.hint}
          </div>
        )}
      </div>
      <div className="font-heading text-sm font-semibold tabular-nums whitespace-nowrap text-cog-teal-dark">
        + {fallback.label}
      </div>
    </button>
  )
}

function AdHocExpandedRow({
  pricingModel,
  label,
  initialDescription,
  workshopId,
  config,
  onCancel,
  onAdd,
}: {
  pricingModel: PricingModel
  label: string
  initialDescription: string
  workshopId: WorkshopId
  config: PricingConfig
  onCancel: () => void
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const [description, setDescription] = useState(initialDescription)
  const baseItem: Omit<
    CheckoutItemLocal,
    "quantity" | "totalPrice" | "formInputs"
  > = {
    id: "",
    workshop: workshopId,
    description,
    origin: "manual",
    catalogId: null,
    pricingModel,
    unitPrice: 0,
  }

  // Direct (Pauschal) is its own fully-editable form: description + cost.
  // The other fallback models share a Beschreibung field on top + a
  // pricing-model-specific dimensions + price grid below.
  return (
    <div className="border-b border-border bg-secondary px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Eigener Eintrag · {label}
        </span>
        <button
          type="button"
          aria-label="Auswahl schliessen"
          onClick={onCancel}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-background"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {pricingModel === "direct" ? (
        <DirectForm baseItem={baseItem} onAdd={onAdd} />
      ) : (
        <>
          <div className="mb-3">
            <Label className="text-xs font-bold">Beschreibung</Label>
            <input
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="z.B. Reststück Buche"
              className={INPUT_CLS}
            />
          </div>
          <AdHocSimpleEntryForm
            pricingModel={pricingModel}
            config={config}
            baseItem={{ ...baseItem, description }}
            descriptionFilled={description.trim().length > 0}
            onAdd={onAdd}
          />
        </>
      )}
    </div>
  )
}

function AdHocSimpleEntryForm({
  pricingModel,
  config,
  baseItem,
  descriptionFilled,
  onAdd,
}: {
  pricingModel: PricingModel
  config: PricingConfig
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  descriptionFilled: boolean
  onAdd: (item: CheckoutItemLocal) => void
}) {
  switch (pricingModel) {
    case "area":
      return (
        <AdHocAreaForm
          config={config}
          baseItem={baseItem}
          descriptionFilled={descriptionFilled}
          onAdd={onAdd}
        />
      )
    case "length":
      return (
        <AdHocLengthForm
          config={config}
          baseItem={baseItem}
          descriptionFilled={descriptionFilled}
          onAdd={onAdd}
        />
      )
    case "count":
    case "weight":
    case "time":
    default:
      return (
        <AdHocCountWeightTimeForm
          pricingModel={pricingModel}
          config={config}
          baseItem={baseItem}
          descriptionFilled={descriptionFilled}
          onAdd={onAdd}
        />
      )
  }
}

function AdHocCountWeightTimeForm({
  pricingModel,
  config,
  baseItem,
  descriptionFilled,
  onAdd,
}: {
  pricingModel: PricingModel
  config: PricingConfig
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  descriptionFilled: boolean
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const isWeight = pricingModel === "weight"
  const isTime = pricingModel === "time"
  const displayUnit = isWeight
    ? "g"
    : isTime
      ? "min"
      : getUnitLabel(config, pricingModel)
  const baseUnit = getUnitLabel(config, pricingModel)
  const [raw, setRaw] = useState(0)
  const [unitPrice, setUnitPrice] = useState(0)
  const baseQty = isWeight ? raw / 1000 : isTime ? raw / 60 : raw
  const total = Math.round(baseQty * unitPrice * 100) / 100
  return (
    <FormGrid>
      <FormField label={`Anzahl (${displayUnit})`}>
        <input
          type="number"
          min="0"
          step="any"
          value={raw || ""}
          onChange={(e) =>
            setRaw(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label={`Preis/${baseUnit}`}>
        <input
          type="number"
          min="0"
          step="any"
          value={unitPrice || ""}
          onChange={(e) =>
            setUnitPrice(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <LiveTotal value={total} />
      <AddButton
        disabled={!descriptionFilled || total <= 0}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            quantity: baseQty,
            unitPrice,
            totalPrice: total,
            formInputs: [{ quantity: raw, unit: displayUnit }],
          })
          setRaw(0)
          setUnitPrice(0)
        }}
      />
    </FormGrid>
  )
}

function AdHocAreaForm({
  config,
  baseItem,
  descriptionFilled,
  onAdd,
}: {
  config: PricingConfig
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  descriptionFilled: boolean
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const [lengthCm, setLengthCm] = useState(0)
  const [widthCm, setWidthCm] = useState(0)
  const [unitPrice, setUnitPrice] = useState(0)
  const m2 = (lengthCm / 100) * (widthCm / 100)
  const total = Math.round(m2 * unitPrice * 100) / 100
  // Five-input ad-hoc area is wider than the four-column FormGrid; the
  // grid auto-flows excess children to a second row, which keeps the
  // layout readable on both desktop and mobile without a custom grid.
  return (
    <FormGrid>
      <FormField label="Länge (cm)">
        <input
          type="number"
          min="0"
          step="any"
          value={lengthCm || ""}
          onChange={(e) =>
            setLengthCm(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label="Breite (cm)">
        <input
          type="number"
          min="0"
          step="any"
          value={widthCm || ""}
          onChange={(e) =>
            setWidthCm(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label={getUnitLabel(config, "area")}>
        <div className="flex h-9 items-center text-sm tabular-nums">
          {m2.toFixed(2)}
        </div>
      </FormField>
      <FormField label={`Preis/${getUnitLabel(config, "area")}`}>
        <input
          type="number"
          min="0"
          step="any"
          value={unitPrice || ""}
          onChange={(e) =>
            setUnitPrice(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <LiveTotal value={total} />
      <AddButton
        disabled={!descriptionFilled || total <= 0}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            quantity: m2,
            unitPrice,
            totalPrice: total,
            formInputs: [
              { quantity: lengthCm, unit: "cm" },
              { quantity: widthCm, unit: "cm" },
            ],
          })
          setLengthCm(0)
          setWidthCm(0)
          setUnitPrice(0)
        }}
      />
    </FormGrid>
  )
}

function AdHocLengthForm({
  config,
  baseItem,
  descriptionFilled,
  onAdd,
}: {
  config: PricingConfig
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  descriptionFilled: boolean
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const [lengthCm, setLengthCm] = useState(0)
  const [unitPrice, setUnitPrice] = useState(0)
  const meters = lengthCm / 100
  const total = Math.round(meters * unitPrice * 100) / 100
  return (
    <FormGrid>
      <FormField label="Länge (cm)">
        <input
          type="number"
          min="0"
          step="any"
          value={lengthCm || ""}
          onChange={(e) =>
            setLengthCm(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label={`Preis/${getUnitLabel(config, "length")}`}>
        <input
          type="number"
          min="0"
          step="any"
          value={unitPrice || ""}
          onChange={(e) =>
            setUnitPrice(Math.max(0, parseFloat(e.target.value) || 0))
          }
          className={INPUT_CLS}
        />
      </FormField>
      <LiveTotal value={total} />
      <AddButton
        disabled={!descriptionFilled || total <= 0}
        onClick={() => {
          onAdd({
            ...baseItem,
            id: crypto.randomUUID(),
            quantity: meters,
            unitPrice,
            totalPrice: total,
            formInputs: [{ quantity: lengthCm, unit: "cm" }],
          })
          setLengthCm(0)
          setUnitPrice(0)
        }}
      />
    </FormGrid>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  // 2-col on mobile, 4-col on desktop. Total + Add button live at the right
  // end on desktop and stack below the inputs on mobile.
  return (
    <div className="grid grid-cols-2 items-end gap-x-3 gap-y-2 sm:grid-cols-[100px_100px_1fr_auto]">
      {children}
    </div>
  )
}

function FormField({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-1" : undefined}>
      <Label className="text-xs font-bold">{label}</Label>
      {children}
    </div>
  )
}
