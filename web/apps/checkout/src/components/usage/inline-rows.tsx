// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, Fragment } from "react"
import { formatCHF } from "@modules/lib/format"
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
import { MaterialPicker } from "./material-picker"
import { PositionTable, type PositionRow, rowFromItem } from "./position-table"

/** Shape of a checkout item used by the workshop block. */
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
  config,
  items,
  catalogItems,
  callbacks,
  discountLevel,
  checkoutId,
  sectionRef,
}: {
  workshopId: WorkshopId
  workshop: WorkshopConfig
  config: PricingConfig
  items: CheckoutItemLocal[]
  catalogItems: CatalogItem[]
  callbacks: ItemCallbacks
  discountLevel: DiscountLevel
  /**
   * Legacy prop kept for callers that pass it; the v5 picker advances state
   * via the picker's local form instead of inline editing, so the wiring
   * is a no-op here. Removed in a follow-up cleanup once all callers stop
   * setting it.
   */
  onBlurSave?: boolean
  checkoutId?: string | null
  /**
   * Legacy prop — v5 surfaces validation through disabled "Hinzufügen" in
   * the picker rather than red-bordered cart rows. Retained only so the
   * existing call sites keep type-checking.
   */
  itemErrors?: Record<string, unknown>
  sectionRef?: (el: HTMLDivElement | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedNfc, setExpandedNfc] = useState<Record<string, boolean>>({})

  const nfcItems = items.filter((i) => i.origin === "nfc")
  const materialItems = items.filter((i) => i.origin !== "nfc")

  const machineTotal = nfcItems.reduce((s, i) => s + i.totalPrice, 0)
  const materialTotal = materialItems.reduce((s, i) => s + i.totalPrice, 0)
  const wsTotal = machineTotal + materialTotal

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

      {nfcItems.length > 0 && (
        <div className="rounded-md border border-border bg-card shadow-sm">
          <div className="px-3 py-3 sm:px-4">
            <PositionTable
              firstColLabel="Maschinen / Werkzeuge"
              rows={nfcRows}
              onToggle={checkoutId ? toggleNfc : undefined}
            />
          </div>
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
            onClick={() => setPickerOpen(true)}
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

      <MaterialPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        workshopId={workshopId}
        workshopLabel={workshop.label}
        catalogItems={catalogItems}
        config={config}
        discountLevel={discountLevel}
        onAdd={callbacks.addItem}
      />
    </section>
  )
}
