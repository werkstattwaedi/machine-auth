// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useRef, Fragment } from "react"
import { formatCHF } from "@modules/lib/format"
import { primaryVariant } from "@modules/lib/pricing"
import { Plus } from "lucide-react"
import { useCollection } from "@modules/lib/firestore"
import { where } from "firebase/firestore"
import { useAuth } from "@modules/lib/auth"
import {
  checkoutItemRef,
  machinesCollection,
  usageMachineCollection,
  userRef as userRefHelper,
} from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import type {
  PricingConfig,
  WorkshopId,
  WorkshopConfig,
  CatalogItem,
  DiscountLevel,
  PricingModel,
} from "@modules/lib/workshop-config"
import { isMachineItem, priceForTier, type ItemType } from "@oww/shared"
import { PositionTable, type PositionRow, rowFromItem } from "./position-table"

/** Shape of a checkout item used by the workshop block. */
export interface CheckoutItemLocal {
  id: string
  workshop: string
  description: string
  origin: "nfc" | "manual" | "qr"
  /** Billing classification (issue #105); absent = material. */
  type?: ItemType | null
  catalogId: string | null
  /** Matches catalog.variants[i].id when catalogId is set. Null for ad-hoc fallback rows. */
  variantId?: string | null
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

// ---------------------------------------------------------------------------
// Per-session breakdown rendered inside an expanded NFC machine row.
// Columns Maschine | Start | Dauer (left-aligned, tabular-nums for the time
// columns). Sessions are read-only by design — there is no remove
// affordance here.
// ---------------------------------------------------------------------------

function NfcUsageDetails({
  checkoutId,
  itemId,
}: {
  checkoutId: string
  itemId: string
}) {
  const db = useDb()
  const { userDoc } = useAuth()
  const ref = checkoutItemRef(db, checkoutId, itemId)
  // Query must filter on `userId` to satisfy the per-user `usage_machine`
  // security rule (`resource.data.userId == /databases/.../users/uid`),
  // which is only checkable when the predicate is part of the query.
  // Without this, Firestore rejects the listen with permission-denied.
  const userDocRef = userDoc ? userRefHelper(db, userDoc.id) : null
  const { data, loading } = useCollection(
    userDocRef ? usageMachineCollection(db) : null,
    ...(userDocRef
      ? [
          where("userId", "==", userDocRef),
          where("checkoutItemRef", "==", ref),
        ]
      : []),
  )
  const { data: machinesDocs } = useCollection(machinesCollection(db))
  const machines = new Map(machinesDocs.map((d) => [d.id, d.name]))

  if (loading)
    return <div className="text-xs text-muted-foreground py-1">Laden...</div>
  if (data.length === 0)
    return (
      <div className="text-xs text-muted-foreground py-1">
        Keine Maschinennutzungen
      </div>
    )

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

  const grouped = new Map<
    string,
    { label: string | null; entries: typeof data }
  >()
  for (const rec of data) {
    const start = rec.startTime?.toDate()
    if (!start) continue
    const key = `${start.getFullYear()}-${String(start.getMonth()).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`
    const isToday = key === todayKey
    if (!grouped.has(key)) {
      grouped.set(key, {
        label: isToday
          ? null
          : start.toLocaleDateString("de-CH", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
            }),
        entries: [],
      })
    }
    grouped.get(key)!.entries.push(rec)
  }

  const sortedGroups = [...grouped.entries()].sort(([a], [b]) =>
    b.localeCompare(a),
  )
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
          <th className="text-left font-medium pb-1 pr-4">Start</th>
          <th className="text-left font-medium pb-1">Dauer</th>
        </tr>
      </thead>
      <tbody>
        {sortedGroups.map(([key, group]) => (
          <Fragment key={key}>
            {group.label && (
              <tr>
                <td
                  colSpan={3}
                  className="pt-2 pb-0.5 font-bold text-muted-foreground"
                >
                  {group.label}
                </td>
              </tr>
            )}
            {group.entries.map((rec) => {
              const start = rec.startTime?.toDate()
              const end = rec.endTime?.toDate()
              const machineName = rec.machine
                ? (machines.get(rec.machine.id) ?? rec.machine.id)
                : "–"
              const durationMin =
                start && end
                  ? Math.round((end.getTime() - start.getTime()) / 60000)
                  : null
              const timeStr = start
                ? start.toLocaleTimeString("de-CH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""
              return (
                <tr key={rec.id} className="text-muted-foreground">
                  <td className="py-0.5 pr-4">{machineName}</td>
                  <td className="py-0.5 pr-4 tabular-nums">{timeStr}</td>
                  <td className="py-0.5 tabular-nums">
                    {durationMin != null ? `${durationMin} Min` : "aktiv"}
                  </td>
                </tr>
              )
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Standalone NFC machine row — kept exported for unit tests that exercise the
// summary content without the surrounding workshop block. Production rendering
// goes through `WorkshopInlineSection` so machines and material share the
// `PositionTable` columns and alignment.
// ---------------------------------------------------------------------------

/**
 * Format a CheckoutItemLocal of `origin === "nfc"` into a PositionRow row
 * compatible with `PositionTable`. The shared row layout (Menge / Kosten /
 * Preis) gives machine + material rows the same column rhythm.
 */
function nfcMachineRow(
  item: CheckoutItemLocal,
  expanded: boolean,
  expandedContent: React.ReactNode,
): PositionRow {
  const minutes = Math.round(item.quantity * 60)
  // Machines bill per hour; the unit-price column shows that explicitly so
  // the rate is legible even when the time-axis is in minutes.
  const kosten = item.unitPrice > 0 ? `${item.unitPrice.toFixed(2)}/Std.` : ""
  return {
    key: item.id,
    title: item.description,
    subtitle: null,
    menge: `${minutes} Min`,
    kosten,
    preis: item.totalPrice.toFixed(2),
    expanded,
    expandedContent,
  }
}

export function NfcMachineItemRow({
  item,
  checkoutId,
}: {
  item: CheckoutItemLocal
  checkoutId: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const row = nfcMachineRow(
    item,
    expanded,
    expanded && checkoutId ? (
      <NfcUsageDetails checkoutId={checkoutId} itemId={item.id} />
    ) : null,
  )
  return (
    <PositionTable
      firstColLabel="Maschinen / Werkzeuge"
      rows={[row]}
      onToggle={checkoutId ? () => setExpanded((v) => !v) : undefined}
    />
  )
}

// ---------------------------------------------------------------------------
// Workshop block — v5 layout: card container, two split sub-boxes for
// machines and material, plain heading, hidden sub-labels, alternating
// stripes. See `Walkthrough v5.html` (machine-material-workshop-usage design
// handoff) for the visual reference.
// ---------------------------------------------------------------------------

export function WorkshopInlineSection({
  workshopId,
  workshop,
  items,
  callbacks,
  checkoutId,
  sectionRef,
  onAddMaterial,
  pinnedCatalog = [],
  discountLevel = "none",
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  items: CheckoutItemLocal[]
  callbacks: ItemCallbacks
  /** Unused since the picker moved to a separate component (issue #213). */
  config?: PricingConfig
  /** Unused since the picker moved to a separate component (issue #213). */
  catalogItems?: CatalogItem[]
  /**
   * Member/default pricing tier for the identified principal — used to
   * resolve pinned-machine hourly rates (issue #105).
   */
  discountLevel?: DiscountLevel
  /**
   * Catalog docs for this workshop's `config/pricing.pinnedMachines` — each
   * renders an always-visible hours input in the machine section while no
   * MaCo is deployed (issue #105).
   */
  pinnedCatalog?: CatalogItem[]
  /** Legacy no-op kept for callers that still set it. */
  onBlurSave?: boolean
  checkoutId?: string | null
  /** Legacy no-op kept for callers that still set it. */
  itemErrors?: Record<string, unknown>
  sectionRef?: (el: HTMLDivElement | null) => void
  /**
   * Open the material picker for this workshop. The host owns how the
   * picker mounts — auth dashboard navigates to a route overlay
   * (`/visit/add/workshop/$id`); the anonymous checkout opens an inline
   * Sheet — so this component stays route-agnostic and works in both.
   */
  onAddMaterial: () => void
}) {
  const [expandedNfc, setExpandedNfc] = useState<Record<string, boolean>>({})

  // Machine usage (NFC-tracked or manually-entered hours) bills as
  // "Maschinennutzung"; everything else is material (issue #105). The
  // material box also excludes NFC items defensively — production NFC usage
  // always carries type "machine", but this keeps a type-less NFC row out of
  // the material box rather than double-rendering it.
  const nfcItems = items.filter((i) => i.origin === "nfc")
  const machineItems = items.filter((i) => isMachineItem(i))
  const materialItems = items.filter(
    (i) => !isMachineItem(i) && i.origin !== "nfc",
  )

  const machineTotal = machineItems.reduce((s, i) => s + i.totalPrice, 0)
  const materialTotal = materialItems.reduce((s, i) => s + i.totalPrice, 0)
  const wsTotal = machineTotal + materialTotal
  const showMachineBox = nfcItems.length > 0 || pinnedCatalog.length > 0

  const nfcRows: PositionRow[] = nfcItems.map((item) => {
    const isExpanded = !!expandedNfc[item.id]
    return nfcMachineRow(
      item,
      isExpanded,
      isExpanded && checkoutId ? (
        <NfcUsageDetails checkoutId={checkoutId} itemId={item.id} />
      ) : null,
    )
  })

  const toggleNfc = (id: string) => {
    if (!checkoutId) return
    setExpandedNfc((m) => ({ ...m, [id]: !m[id] }))
  }

  return (
    <section
      ref={sectionRef}
      className="space-y-3"
      data-testid={`workshop-block-${workshopId}`}
    >
      <h2 className="font-heading text-xl font-bold sm:text-2xl">
        {workshop.label}
      </h2>

      {showMachineBox && (
        <div className="rounded-md border border-border bg-card shadow-sm">
          {nfcItems.length > 0 && (
            <div className="px-3 py-3 sm:px-4">
              <PositionTable
                firstColLabel="Maschinen / Werkzeuge"
                rows={nfcRows}
                onToggle={checkoutId ? toggleNfc : undefined}
              />
            </div>
          )}
          {pinnedCatalog.length > 0 && (
            <div
              className={
                "px-3 py-3 sm:px-4" +
                (nfcItems.length > 0 ? " border-t border-border/60" : "")
              }
            >
              <PinnedMachineLabelRow />
              <ul className="mt-1">
                {pinnedCatalog.map((cat) => (
                  <PinnedMachineRow
                    key={cat.id}
                    workshopId={workshopId}
                    catalog={cat}
                    discountLevel={discountLevel}
                    existing={machineItems.find(
                      (i) => i.catalogId === cat.id,
                    )}
                    callbacks={callbacks}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border border-border bg-card shadow-sm">
        {materialItems.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
            Noch kein Material aus {workshop.label}.
          </div>
        ) : (
          <div className="px-3 py-3 sm:px-4">
            <PositionTable
              firstColLabel="Bezogenes Material"
              rows={materialItems.map(rowFromItem)}
              onRemove={(id) => callbacks.removeItem(id)}
            />
          </div>
        )}
        {/* Left padding aligns the button visually with the title column of
            the table above. Math: outer px-3 (12px) + remove col (20px) +
            gap-x-4 (16px) = 48px mobile; sm: px-4 (16px) + 20px + gap-x-6
            (24px) = 60px. Empty state has no remove gutter, so the button
            still sits at the smaller outer padding. */}
        <div
          className={
            "py-3 border-t border-border/60 " +
            (materialItems.length === 0
              ? "px-3 sm:px-4"
              : "pl-[48px] pr-3 sm:pl-[60px] sm:pr-4")
          }
        >
          <button
            type="button"
            onClick={onAddMaterial}
            className="inline-flex items-center gap-2 rounded-[3px] border border-dashed border-border px-3 py-2 text-sm font-medium text-cog-teal-dark hover:border-cog-teal hover:bg-cog-teal-light"
          >
            <Plus className="h-3.5 w-3.5" />
            Material hinzufügen
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between px-1 pt-1 text-sm">
        <span className="text-muted-foreground">
          Zwischentotal {workshop.label}
        </span>
        <span className="font-heading text-base font-bold tabular-nums">
          {formatCHF(wsTotal)}
        </span>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pinned machine rows (issue #105). For machines without a MaCo, the cost
// step shows an always-visible hours input so visitors can record usage
// manually. Each pinned machine is a catalog item referenced from
// `config/pricing.workshops[ws].pinnedMachines`; the row IS the
// representation of its checkout item — entering hours upserts it, clearing
// removes it.
// ---------------------------------------------------------------------------

function PinnedMachineLabelRow() {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:gap-4">
      <span>Maschinennutzung</span>
      <span className="text-right">Stunden</span>
      <span className="min-w-[70px] text-right">Preis</span>
    </div>
  )
}

function PinnedMachineRow({
  workshopId,
  catalog,
  discountLevel,
  existing,
  callbacks,
}: {
  workshopId: WorkshopId
  catalog: CatalogItem
  discountLevel: DiscountLevel
  existing?: CheckoutItemLocal
  callbacks: ItemCallbacks
}) {
  const variant = primaryVariant(catalog)
  const unitPrice = variant ? priceForTier(variant.unitPrice, discountLevel) : 0
  const pricingModel = variant?.pricingModel ?? "time"

  // Local text decoupled from the stored item so typing survives the
  // snapshot round-trip; synced from the stored quantity while unfocused
  // (mirrors the SpendeCard pattern in step-checkout).
  const [text, setText] = useState(() =>
    existing && existing.quantity > 0 ? String(existing.quantity) : "",
  )
  const focusedRef = useRef(false)
  const storedHours = existing?.quantity ?? 0
  useEffect(() => {
    if (focusedRef.current) return
    const canonical = storedHours > 0 ? String(storedHours) : ""
    const parsed = parseFloat(text.replace(",", ".")) || 0
    if (parsed !== storedHours) setText(canonical)
  }, [storedHours, text])

  const hours = Math.max(0, parseFloat(text.replace(",", ".")) || 0)
  const total = Math.round(hours * unitPrice * 100) / 100

  const commit = () => {
    focusedRef.current = false
    if (hours <= 0) {
      if (existing) callbacks.removeItem(existing.id)
      setText("")
      return
    }
    if (existing) {
      if (existing.quantity === hours) return
      callbacks.updateItem(existing.id, {
        ...existing,
        quantity: hours,
        unitPrice,
        totalPrice: total,
        formInputs: [{ quantity: hours, unit: "h" }],
      })
    } else {
      callbacks.addItem({
        id: crypto.randomUUID(),
        workshop: workshopId,
        description: catalog.name,
        origin: "manual",
        type: "machine",
        catalogId: catalog.id,
        variantId: variant?.id ?? "default",
        pricingModel,
        quantity: hours,
        unitPrice,
        totalPrice: total,
        formInputs: [{ quantity: hours, unit: "h" }],
      })
    }
  }

  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-dotted border-border py-2 last:border-b-0 sm:gap-4">
      <div className="min-w-0">
        <div className="truncate font-heading text-sm font-semibold">
          {catalog.name}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {formatCHF(unitPrice)}/Std.
        </div>
      </div>
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={text}
        aria-label={`Stunden ${catalog.name}`}
        onFocus={() => {
          focusedRef.current = true
        }}
        onChange={(e) => {
          const raw = e.target.value
          if (parseFloat(raw) < 0) return
          setText(raw)
        }}
        onBlur={commit}
        placeholder="0"
        className="h-9 w-20 rounded-none border border-[#ccc] bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-cog-teal"
      />
      <span className="min-w-[70px] text-right text-sm font-semibold tabular-nums">
        {total > 0 ? total.toFixed(2) : ""}
      </span>
    </li>
  )
}
