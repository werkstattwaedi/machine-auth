// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, Fragment } from "react"
import { formatCHF } from "@modules/lib/format"
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from "lucide-react"
import { useCollection } from "@modules/lib/firestore"
import { where } from "firebase/firestore"
import {
  checkoutItemRef,
  machinesCollection,
  usageMachineCollection,
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
// Material line item — static row rendered in the cart after the picker
// adds an entry. Per v5 design, material is no longer edited inline; the
// member removes and re-adds via the picker if a value needs changing.
// ---------------------------------------------------------------------------

function formatItemQuantity(item: CheckoutItemLocal): string {
  const pm = item.pricingModel
  if (pm === "direct") return ""
  if (pm === "sla") {
    const ml = item.formInputs?.[0]?.quantity ?? 0
    const layers = item.formInputs?.[1]?.quantity ?? 0
    return `${ml} ml · ${layers} Layer`
  }
  if (pm === "area" && item.formInputs?.length === 2) {
    const [l, w] = item.formInputs
    return `${l.quantity}×${w.quantity} ${l.unit} × ${formatCHF(item.unitPrice)}`
  }
  // weight (g) / time (min) prefer the form input so the member sees the
  // friendly unit they entered, not the base-unit value (kg / h).
  if (item.formInputs?.[0]) {
    const f = item.formInputs[0]
    return `${f.quantity} ${f.unit} × ${formatCHF(item.unitPrice)}`
  }
  return `${item.quantity} × ${formatCHF(item.unitPrice)}`
}

function MaterialLineItem({
  item,
  onRemove,
  striped,
}: {
  item: CheckoutItemLocal
  onRemove: () => void
  striped: boolean
}) {
  return (
    <div
      className={
        "grid grid-cols-[1fr_auto_24px_auto] items-center gap-3 border-t border-black/5 px-4 py-3 first:border-t-0 sm:grid-cols-[18px_1fr_auto_24px_auto] sm:px-6 " +
        (striped ? "bg-black/[0.02]" : "")
      }
    >
      <span className="hidden sm:block" />
      <div className="min-w-0">
        <div className="font-heading text-sm font-semibold truncate">
          {item.description}
        </div>
      </div>
      <div className="hidden text-xs tabular-nums text-muted-foreground whitespace-nowrap sm:block">
        {formatItemQuantity(item)}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Entfernen"
        className="flex h-6 w-6 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-black/5 hover:text-destructive sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="font-heading text-base font-bold tabular-nums whitespace-nowrap text-right min-w-[80px]">
        {formatCHF(item.totalPrice)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Machine row — collapsed summary, click to expand for the per-session
// breakdown. NFC sessions are read-only by design.
// ---------------------------------------------------------------------------

function NfcUsageDetails({
  checkoutId,
  itemId,
}: {
  checkoutId: string
  itemId: string
}) {
  const db = useDb()
  const ref = checkoutItemRef(db, checkoutId, itemId)
  const { data, loading } = useCollection(
    usageMachineCollection(db),
    where("checkoutItemRef", "==", ref),
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
          <th className="text-right font-medium pb-1 pr-2">Dauer</th>
          <th className="text-right font-medium pb-1">Start</th>
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
  checkoutId,
  striped,
}: {
  item: CheckoutItemLocal
  checkoutId: string | null
  striped?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const minutes = Math.round(item.quantity * 60)
  const summary = `${minutes} min`

  return (
    <div
      className={
        "border-t border-black/5 first:border-t-0 " +
        (striped ? "bg-black/[0.02]" : "")
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!checkoutId}
        className="grid w-full grid-cols-[18px_1fr_auto_auto] items-center gap-3 px-4 py-3 text-left enabled:hover:bg-black/[0.025] disabled:cursor-default sm:px-6"
      >
        <span className="text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="font-heading text-sm font-semibold truncate">
          {item.description}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
          {summary}
        </span>
        <span className="font-heading text-base font-bold tabular-nums whitespace-nowrap min-w-[80px] text-right">
          {formatCHF(item.totalPrice)}
        </span>
      </button>
      {expanded && checkoutId && (
        <div className="px-4 pb-3 pl-10 sm:px-6 sm:pl-12">
          <NfcUsageDetails checkoutId={checkoutId} itemId={item.id} />
        </div>
      )}
    </div>
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

  const nfcItems = items.filter((i) => i.origin === "nfc")
  const materialItems = items.filter((i) => i.origin !== "nfc")

  const machineTotal = nfcItems.reduce((s, i) => s + i.totalPrice, 0)
  const materialTotal = materialItems.reduce((s, i) => s + i.totalPrice, 0)
  const wsTotal = machineTotal + materialTotal

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
        <div className="rounded-md border border-border bg-card py-1 shadow-sm">
          {nfcItems.map((item, i) => (
            <NfcMachineItemRow
              key={item.id}
              item={item}
              checkoutId={checkoutId ?? null}
              striped={i % 2 === 1}
            />
          ))}
        </div>
      )}

      <div className="rounded-md border border-border bg-card py-1 shadow-sm">
        {materialItems.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
            Noch kein Material aus {workshop.label}.
          </div>
        ) : (
          <div className="group">
            {materialItems.map((item, i) => (
              <MaterialLineItem
                key={item.id}
                item={item}
                striped={i % 2 === 1}
                onRemove={() => callbacks.removeItem(item.id)}
              />
            ))}
          </div>
        )}
        <div className="px-4 py-3 sm:px-6">
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
