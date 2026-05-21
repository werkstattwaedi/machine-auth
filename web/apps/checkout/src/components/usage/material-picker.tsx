// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import React, { useMemo, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@modules/components/ui/sheet"
import { Collapsible, VisuallyHidden } from "radix-ui"
import { Label } from "@modules/components/ui/label"
import { useIsMobile } from "@modules/hooks/use-mobile"
import { formatCHF } from "@modules/lib/format"
import { formatPricePerCount } from "@modules/lib/units"
import { ChevronRight, Search, X } from "lucide-react"
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
import {
  filterByCategoryPrefix,
  nextLevelValues,
} from "@modules/lib/categories"
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

/**
 * What set of catalog items the picker should surface, and how to label
 * the panel. The host is responsible for pre-filtering `catalogItems`
 * to match the scope (no extra narrowing happens inside the picker).
 *
 * - `all`: full catalog, browse-and-search entry point (also the QR
 *   scanner's empty-state fallback).
 * - `workshop`: catalog narrowed to one workshop — the "+ Material
 *   hinzufügen" button on a workshop card.
 * - `list`: the items defined by a pricelist (reached via the price-list
 *   QR code on a printed PDF).
 * - `item`: a single catalog item, e.g. from a per-item QR sticker.
 *   The variant chooser auto-expands on open. `variantId` is optional
 *   — when set, that variant is pre-selected (per-variant QR stickers,
 *   e.g. "Zuschnitt A3"). Unknown variantIds fall back to `variants[0]`.
 */
export type PickerScope =
  | { kind: "all" }
  | { kind: "workshop"; workshopId: WorkshopId; workshopLabel: string }
  | { kind: "list"; listId: string; listName: string }
  | { kind: "item"; code: string; itemId: string; variantId?: string }

interface MaterialPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: PickerScope
  catalogItems: CatalogItem[]
  config: PricingConfig
  discountLevel: DiscountLevel
  /**
   * Resolve which workshop a given catalog item is attributed to on add.
   * For `workshop` scope, always returns the scope's workshopId. For
   * other scopes, the host consults `checkout.workshopsVisited`
   * (overlap-first) then falls back to `catalog.workshops[0]`. Called
   * with `null` for ad-hoc rows (only visible in `workshop` scope, so
   * the host can return the scope's workshopId there).
   */
  resolveWorkshop: (catalog: CatalogItem | null) => WorkshopId
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
  scope,
  catalogItems,
  config,
  discountLevel,
  resolveWorkshop,
  onAdd,
}: MaterialPickerProps) {
  const isMobile = useIsMobile()
  const description = describeScope(scope)
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
          <SheetDescription>{description}</SheetDescription>
        </VisuallyHidden.Root>

        {isMobile && (
          <div className="flex justify-center pt-2">
            <span className="block h-1 w-10 rounded-full bg-[#d0d0d0]" />
          </div>
        )}

        <PickerHeader onClose={() => onOpenChange(false)}>
          {(query) => (
            <PickerBody
              scope={scope}
              catalogItems={catalogItems}
              config={config}
              discountLevel={discountLevel}
              query={query}
              resolveWorkshop={resolveWorkshop}
              onAdd={onAdd}
            />
          )}
        </PickerHeader>
      </SheetContent>
    </Sheet>
  )
}

function describeScope(scope: PickerScope): string {
  switch (scope.kind) {
    case "workshop":
      return `Wähle Material für die Werkstatt ${scope.workshopLabel}.`
    case "list":
      return `Wähle Material aus der Preisliste ${scope.listName}.`
    case "item":
      return "Material erfassen."
    case "all":
    default:
      return "Wähle Material."
  }
}

function PickerHeader({
  onClose,
  children,
}: {
  onClose: () => void
  children: (query: string) => React.ReactNode
}) {
  const [query, setQuery] = useState("")

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
      </div>

      {children(query)}
    </>
  )
}

function PickerBody({
  scope,
  catalogItems,
  config,
  discountLevel,
  query,
  resolveWorkshop,
  onAdd,
}: {
  scope: PickerScope
  catalogItems: CatalogItem[]
  config: PricingConfig
  discountLevel: DiscountLevel
  query: string
  resolveWorkshop: (catalog: CatalogItem | null) => WorkshopId
  onAdd: (item: CheckoutItemLocal) => void
}) {
  // At most one row is expanded at a time — either a catalog row or one of
  // the ad-hoc fallback rows. The discriminated union avoids accidental
  // double-expand.
  type Expansion =
    | { kind: "catalog"; id: string }
    | { kind: "fallback"; pricingModel: PricingModel }
    | null
  // For `item` scope, auto-expand the single catalog row so the user
  // lands on the variant chooser / form — the scanned-the-sticker
  // intent is "add this thing", not "browse a one-item list".
  const initialExpansion: Expansion =
    scope.kind === "item" ? { kind: "catalog", id: scope.itemId } : null
  const [expansion, setExpansion] = useState<Expansion>(initialExpansion)

  // Selected category path (a prefix of `category[]`). Empty = no filter.
  const [categoryPrefix, setCategoryPrefix] = useState<string[]>([])

  // Chip rows render as a breadcrumb: at each depth where a category is
  // selected, only that chip is visible. At the next-deeper depth we
  // surface the available siblings (none selected). Click the active
  // chip to step back; click a sibling to drill in.
  //
  // A row with exactly one sibling is hidden — there's no meaningful
  // choice for the user, and the items below already share that
  // single category implicitly. Example: Dübel-und-Rundstäbe has one
  // sub-category, so no sub-row appears.
  const chipRows = useMemo(() => {
    const rows: {
      level: number
      values: string[]
      selected: string | null
    }[] = []
    for (let level = 0; level <= categoryPrefix.length; level++) {
      if (level < categoryPrefix.length) {
        rows.push({
          level,
          values: [categoryPrefix[level]],
          selected: categoryPrefix[level],
        })
        continue
      }
      const values = nextLevelValues(
        catalogItems,
        categoryPrefix.slice(0, level),
      )
      if (values.length <= 1) break
      rows.push({ level, values, selected: null })
    }
    return rows
  }, [catalogItems, categoryPrefix])

  const filtered = useMemo(() => {
    const byCategory = filterByCategoryPrefix(catalogItems, categoryPrefix)
    const q = query.trim().toLowerCase()
    const matches = q
      ? byCategory.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.code?.toLowerCase().includes(q),
        )
      : byCategory
    return [...matches].sort((a, b) => a.name.localeCompare(b.name, "de"))
  }, [catalogItems, categoryPrefix, query])

  function onChipClick(level: number, value: string) {
    setCategoryPrefix((prev) => {
      if (prev[level] === value) {
        // Click an already-active chip → deselect that level + drop deeper.
        return prev.slice(0, level)
      }
      return [...prev.slice(0, level), value]
    })
    // Collapse any expanded row when the filter changes — the user's about
    // to look at a different set of items.
    setExpansion(null)
  }

  // Ad-hoc creation needs a description; show the fallback section only
  // when the user has typed something they can use as the item name.
  // Also: ad-hoc rows only make sense in `workshop` scope — list/item
  // scopes are bounded by definition, and the `all` scope doesn't have a
  // natural workshop to attribute the ad-hoc to.
  const trimmedQuery = query.trim()
  const showFallbacks =
    scope.kind === "workshop" && trimmedQuery.length > 0

  return (
    <>
      {chipRows.length > 0 && (
        <div
          role="group"
          aria-label="Kategorien"
          className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-background px-4 py-2"
        >
          {chipRows.map((row, idx) => (
            <React.Fragment key={row.level}>
              {idx > 0 && (
                <ChevronRight
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-in fade-in duration-150"
                />
              )}
              {row.values.map((value) => (
                <FilterPill
                  key={`${row.level}:${value}`}
                  active={row.selected === value}
                  onClick={() => onChipClick(row.level, value)}
                >
                  {value}
                </FilterPill>
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
      {filtered.length === 0 && !showFallbacks ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Keine Treffer. Such-Begriff anpassen oder einen anderen Filter wählen.
        </div>
      ) : (
        filtered.map((cat) => {
          const isExpanded =
            expansion?.kind === "catalog" && expansion.id === cat.id
          return (
            <PickerRow
              key={cat.id}
              catalog={cat}
              isExpanded={isExpanded}
              config={config}
              discountLevel={discountLevel}
              workshopId={resolveWorkshop(cat)}
              initialVariantId={
                scope.kind === "item" && scope.itemId === cat.id
                  ? scope.variantId
                  : undefined
              }
              onToggle={(open) =>
                setExpansion(open ? { kind: "catalog", id: cat.id } : null)
              }
              onAdd={(item) => {
                onAdd(item)
                setExpansion(null)
              }}
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
                workshopId={resolveWorkshop(null)}
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
    </>
  )
}

/**
 * Variant chooser used by `PickerRowBody` when an item has more than one
 * variant. Implements the ARIA radiogroup keyboard contract — the
 * selected radio holds `tabIndex=0` and arrow keys cycle the selection
 * among siblings (other radios are `tabIndex=-1` so Tab moves focus
 * past the group). Without this, keyboard users had to Tab through
 * every variant individually.
 */
function VariantChooser({
  variants,
  selectedId,
  onChange,
}: {
  variants: ReadonlyArray<{ id: string; label?: string | null }>
  selectedId: string
  onChange: (id: string) => void
}) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const focusByIndex = (idx: number) => {
    const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      'button[role="radio"]',
    )
    buttons?.[idx]?.focus()
  }
  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label="Variante"
      className="mb-3 flex flex-wrap gap-1.5"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
        const idx = variants.findIndex((v) => v.id === selectedId)
        if (idx < 0) return
        const dir = e.key === "ArrowRight" ? 1 : -1
        const next = (idx + dir + variants.length) % variants.length
        e.preventDefault()
        onChange(variants[next].id)
        focusByIndex(next)
      }}
    >
      {variants.map((v) => {
        const isSelected = selectedId === v.id
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(v.id)}
            className={[
              "rounded-[3px] border px-2.5 py-1 text-xs",
              isSelected
                ? "border-cog-teal bg-cog-teal text-white"
                : "border-border bg-background text-foreground hover:bg-secondary",
            ].join(" ")}
          >
            {v.label ?? "Standard"}
          </button>
        )
      })}
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
  // Entry animation fires when the pill first mounts — i.e. when a
  // sibling row of chips becomes visible after the user drills into (or
  // back out of) a category level.
  const base =
    "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs animate-in fade-in slide-in-from-top-1 duration-150"
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? `${base} bg-cog-teal text-white`
          : `${base} bg-secondary text-foreground hover:bg-cog-teal-light`
      }
    >
      {children}
    </button>
  )
}

/**
 * Subtitle shown under each catalog item's name in the picker. Renders
 * the category path with " › " separators plus the SKU code, so a row
 * like "Festool Garant, Korn 80" carries enough context for the user to
 * tell which Schleifmittel sub-family it belongs to (without that, a
 * text search across categories returns several rows that look
 * identical).
 */
function CatalogRowSubtitle({ catalog }: { catalog: CatalogItem }) {
  const path = catalog.category?.filter((p) => p && p.length > 0).join(" › ")
  const hasPath = path && path.length > 0
  const hasCode = Boolean(catalog.code)
  if (!hasPath && !hasCode) return null
  return (
    <div className="text-xs text-muted-foreground truncate">
      {hasPath ? path : null}
      {hasPath && hasCode ? " · " : null}
      {hasCode ? `#${catalog.code}` : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PickerRow — unified collapsed/expanded entry row. The header (name +
// subtitle + price/unit) stays in place regardless of state so the row
// doesn't reorganise on expand. The expansion (variant selector + form)
// is wrapped in Radix `Collapsible.Content` so it animates between 0 and
// its measured height via `--radix-collapsible-content-height`.
//
// State note: variant selection survives for the duration of one open;
// the body unmounts on close (Collapsible.Content unmounts after the
// close animation finishes) so re-opening produces a fresh
// `PickerRowBody` with `variants[0]` selected again.
// ---------------------------------------------------------------------------

function PickerRow({
  catalog,
  isExpanded,
  config,
  discountLevel,
  workshopId,
  initialVariantId,
  onToggle,
  onAdd,
}: {
  catalog: CatalogItem
  isExpanded: boolean
  config: PricingConfig
  discountLevel: DiscountLevel
  workshopId: WorkshopId
  /** Pre-select a specific variant (set by the `item` scope when its
   *  URL carries a variantId segment). Unknown ids fall back silently. */
  initialVariantId?: string
  onToggle: (open: boolean) => void
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const variants = catalog.variants ?? []
  return (
    <Collapsible.Root
      open={isExpanded}
      onOpenChange={onToggle}
      className={[
        "border-b border-border",
        isExpanded ? "bg-secondary" : "",
      ].join(" ")}
    >
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 text-left hover:bg-cog-teal-light data-[state=open]:hover:bg-secondary"
        >
          <div className="min-w-0">
            <div className="font-heading text-sm font-semibold truncate">
              {catalog.name}
            </div>
            <CatalogRowSubtitle catalog={catalog} />
          </div>
          <div className="font-heading text-sm font-semibold tabular-nums whitespace-nowrap">
            {formatCHF(headerUnitPrice(catalog, discountLevel))}
            <span className="ml-0.5 font-body text-[11px] font-normal text-muted-foreground">
              /{getShortUnit(variants[0]?.pricingModel ?? "direct")}
            </span>
          </div>
          {isExpanded ? (
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-background"
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden />
          )}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content
        className="overflow-hidden data-[state=open]:animate-[collapsible-down_180ms_ease-out] data-[state=closed]:animate-[collapsible-up_140ms_ease-in]"
      >
        <PickerRowBody
          // No `:open/:closed` key suffix here — Collapsible.Content's
          // own mount lifecycle handles the close-then-reopen reset. A
          // per-isExpanded key would remount mid-animation, leaving the
          // closing panel blank.
          key={catalog.id}
          catalog={catalog}
          config={config}
          discountLevel={discountLevel}
          workshopId={workshopId}
          initialVariantId={initialVariantId}
          onAdd={onAdd}
        />
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

/**
 * Unit price for the header — uses `variants[0]` (the canonical
 * default). When the row is expanded and the user picks a different
 * variant the inner body shows that variant's price; the header keeps
 * the canonical one so the row doesn't visually flicker while the user
 * is browsing options.
 */
function headerUnitPrice(
  catalog: CatalogItem,
  discountLevel: DiscountLevel,
): number {
  const v = catalog.variants?.[0]
  if (!v) return 0
  return discountLevel === "member" && typeof v.unitPrice.member === "number"
    ? v.unitPrice.member
    : v.unitPrice.default
}

function PickerRowBody({
  catalog,
  config,
  discountLevel,
  workshopId,
  initialVariantId,
  onAdd,
}: {
  catalog: CatalogItem
  config: PricingConfig
  discountLevel: DiscountLevel
  workshopId: WorkshopId
  /** Pre-select a specific variant; unknown ids fall back to variants[0]. */
  initialVariantId?: string
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const variants = catalog.variants ?? []
  // Lazy initializer: runs once per mount. Keeping the warn in here
  // (rather than the component body) avoids logging on every render
  // / strict-mode double-invoke.
  const [selectedVariantId, setSelectedVariantId] = useState<string>(() => {
    const resolved =
      (initialVariantId &&
        variants.find((v) => v.id === initialVariantId)?.id) ??
      variants[0]?.id ??
      "default"
    if (initialVariantId && resolved !== initialVariantId) {
      // eslint-disable-next-line no-console
      console.warn(
        `Unknown variantId "${initialVariantId}" for catalog item ${catalog.code}; falling back to variants[0].`,
      )
    }
    return resolved
  })
  const variant =
    variants.find((v) => v.id === selectedVariantId) ?? variants[0]
  const unitPrice = variant
    ? discountLevel === "member" &&
      typeof variant.unitPrice.member === "number"
      ? variant.unitPrice.member
      : variant.unitPrice.default
    : 0
  const baseItem: Omit<
    CheckoutItemLocal,
    "quantity" | "totalPrice" | "formInputs"
  > = {
    id: "",
    workshop: workshopId,
    description: variant?.label
      ? `${catalog.name} · ${variant.label}`
      : catalog.name,
    origin: "manual",
    catalogId: catalog.id,
    variantId: variant?.id ?? null,
    pricingModel: variant?.pricingModel ?? null,
    unitPrice,
  }

  return (
    <div className="px-4 pb-4">
      {variants.length > 1 && (
        <VariantChooser
          variants={variants}
          selectedId={selectedVariantId}
          onChange={setSelectedVariantId}
        />
      )}
      <PickerEntryForm
        key={variant?.id ?? "default"}
        catalog={catalog}
        config={config}
        pricingModel={variant?.pricingModel ?? "direct"}
        unitPrice={unitPrice}
        discountLevel={discountLevel}
        baseItem={baseItem}
        onAdd={onAdd}
      />
    </div>
  )
}

function PickerEntryForm({
  catalog: _catalog,
  config,
  pricingModel,
  unitPrice,
  discountLevel,
  baseItem,
  onAdd,
}: {
  catalog: CatalogItem
  config: PricingConfig
  pricingModel: PricingModel
  unitPrice: number
  discountLevel: DiscountLevel
  baseItem: Omit<CheckoutItemLocal, "quantity" | "totalPrice" | "formInputs">
  onAdd: (item: CheckoutItemLocal) => void
}) {
  const pm = pricingModel
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

/**
 * Stable footer beneath every form. Total on the left (blank until the
 * inputs amount to something), Hinzufügen on the right. Sits *outside*
 * the input grid so the inputs don't have to fight the button for the
 * last column, and the layout reads the same way regardless of how
 * many fields the form happens to expose (Anzahl-only vs Länge ×
 * Breite × m² etc.).
 */
function FormFooter({
  total,
  addDisabled,
  onAdd,
}: {
  total: number
  addDisabled: boolean
  onAdd: () => void
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="font-heading text-base font-bold tabular-nums text-cog-teal-dark">
        {total > 0 ? formatCHF(total) : ""}
      </div>
      <AddButton disabled={addDisabled} onClick={onAdd} />
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
    <>
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
      </FormGrid>
      <FormFooter
        total={total}
        addDisabled={baseQty <= 0}
        onAdd={() => {
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
    </>
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
    <>
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
      </FormGrid>
      <FormFooter
        total={total}
        addDisabled={m2 <= 0}
        onAdd={() => {
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
    </>
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
    <>
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
      </FormGrid>
      <FormFooter
        total={total}
        addDisabled={meters <= 0}
        onAdd={() => {
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
    </>
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
    <>
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
      </FormGrid>
      <FormFooter
        total={total}
        addDisabled={total <= 0}
        onAdd={() => {
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
    </>
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
    <>
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
      </FormGrid>
      <FormFooter
        total={cost}
        addDisabled={cost <= 0 || !description.trim()}
        onAdd={() => {
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
    </>
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
    <>
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
      </FormGrid>
      <FormFooter
        total={total}
        addDisabled={!descriptionFilled || total <= 0}
        onAdd={() => {
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
    </>
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
  return (
    <>
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
      </FormGrid>
      <FormFooter
        total={total}
        addDisabled={!descriptionFilled || total <= 0}
        onAdd={() => {
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
    </>
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
    <>
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
      </FormGrid>
      <FormFooter
        total={total}
        addDisabled={!descriptionFilled || total <= 0}
        onAdd={() => {
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
    </>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  // 2-col on mobile, 4-col on desktop. FormFooter renders the live total
  // and Hinzufügen button beneath the grid so the input layout is
  // independent of the form's button placement.
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
