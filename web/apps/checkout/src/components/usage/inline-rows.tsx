// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useEffect, useRef, useMemo, Fragment } from "react"
import { formatCHF } from "@modules/lib/format"
import { primaryVariant } from "@modules/lib/pricing"
import { Plus, X } from "lucide-react"
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
import {
  workshopColor,
  type PricingConfig,
  type WorkshopId,
  type WorkshopConfig,
  type CatalogItem,
  type DiscountLevel,
  type PricingModel,
} from "@modules/lib/workshop-config"
import { isMachineItem, priceForTier, type ItemType } from "@oww/shared"
import { parseQuantity, formatQuantity } from "@modules/lib/units"
import { ErrorBadge } from "@/components/checkout/field-error"
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
    // NFC usage is server-owned (MaCo sessions) — never client-removable.
    removable: false,
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
  onAddMaterial,
  onRemoveWorkshop,
  pinnedCatalog = [],
  discountLevel = "none",
  footerSlot,
  onValidityChange,
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
  /**
   * Open the material picker for this workshop. The host owns how the
   * picker mounts — auth dashboard navigates to a route overlay
   * (`/visit/add/workshop/$id`); the anonymous checkout opens an inline
   * Sheet — so this component stays route-agnostic and works in both.
   */
  onAddMaterial: () => void
  /**
   * Remove this workshop from the visit (Werkstatt-Auswahl handoff): renders
   * a (×) button in the section header. The host owns the confirm dialog and
   * the exit animation; omitting the prop hides the button.
   */
  onRemoveWorkshop?: () => void
  /**
   * Extra content rendered at the bottom of the section, between the
   * material box and the Zwischentotal. Used by /visit to nest the
   * self-service badge hint inside Diverses (issue #505).
   */
  footerSlot?: React.ReactNode
  /**
   * Reports whether any always-visible field in this section currently holds
   * an unparseable value. Lets the Kosten step block "Zum Checkout" until the
   * error is fixed. Callers should pass a stable callback keyed by workshop.
   */
  onValidityChange?: (hasError: boolean) => void
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
  const materialTotal = materialItems.reduce((s, i) => s + i.totalPrice, 0)

  const pinnedIds = new Set(pinnedCatalog.map((c) => c.id))
  // Machine items that are neither NFC nor pinned — e.g. a user-addable
  // machine catalog item picked via the material picker (Sandstrahlen). They
  // bill as machine, so without rendering them here they'd vanish from the
  // workshop view; surface them as ordinary removable rows in the machine
  // table (issue #105 review).
  const otherMachineRows: PositionRow[] = machineItems
    .filter((i) => i.origin !== "nfc" && !(i.catalogId && pinnedIds.has(i.catalogId)))
    .map(rowFromItem)

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

  // Pinned machines (issue #105): an always-visible input per MaCo-less
  // machine, rendered as ordinary rows in the shared "Maschinen / Werkzeuge"
  // table (Menge holds the input, Kosten the rate, Preis the live total).
  // Hourly machines take hours (× CHF/Std.); direct-model machines (Pauschal
  // CHF, e.g. Keramik-Brennen, issue #555) take the CHF amount itself. The
  // field text lives here (keyed by catalogId) so Preis updates as the user
  // types; it's synced from the committed item while the field is unfocused
  // (SpendeCard pattern) and committed on blur.
  const pinnedItemByCatalog = useMemo(() => {
    const m = new Map<string, CheckoutItemLocal>()
    for (const i of machineItems) if (i.catalogId) m.set(i.catalogId, i)
    return m
  }, [machineItems])
  const [pinnedText, setPinnedText] = useState<Record<string, string>>({})
  // Fields whose current text failed to parse (unknown unit). We keep the
  // verbatim text and show an inline error rather than silently zeroing it.
  const [pinnedError, setPinnedError] = useState<Record<string, boolean>>({})
  const hasPinnedError = Object.values(pinnedError).some(Boolean)
  useEffect(() => {
    onValidityChange?.(hasPinnedError)
  }, [hasPinnedError, onValidityChange])
  const pinnedFocusRef = useRef<string | null>(null)
  useEffect(() => {
    setPinnedText((prev) => {
      let changed = false
      const next = { ...prev }
      for (const cat of pinnedCatalog) {
        if (pinnedFocusRef.current === cat.id) continue
        // Don't clobber a field the user is being asked to fix.
        if (pinnedError[cat.id]) continue
        const item = pinnedItemByCatalog.get(cat.id)
        const direct = isDirectPinned(cat)
        const q = direct ? (item?.totalPrice ?? 0) : (item?.quantity ?? 0)
        const current = prev[cat.id] ?? ""
        if (direct) {
          // CHF: keep the verbatim number; only rewrite when it no longer
          // matches the committed amount.
          const parsed = parsePinnedValue(current, true)
          if (parsed === null) continue
          if (parsed !== q) {
            next[cat.id] = q > 0 ? String(q) : ""
            changed = true
          }
        } else {
          // Hourly: normalise to the largest unit with a whole value
          // (30min → "30 min", 90min → "1.5 h", 0.5h → "30 min").
          const canonical = q > 0 ? formatQuantity(q, "h") : ""
          if (current !== canonical) {
            next[cat.id] = canonical
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [pinnedItemByCatalog, pinnedCatalog, pinnedError])

  const commitPinned = (cat: CatalogItem, unitPrice: number) => {
    pinnedFocusRef.current = null
    const variant = primaryVariant(cat)
    const direct = isDirectPinned(cat)
    // Hourly: the field holds hours. Direct: it IS the CHF amount from the
    // workshop's price note (issue #555) — quantity 1, unitPrice = total,
    // mirroring the picker's DirectForm item shape.
    const parsed = parsePinnedValue(pinnedText[cat.id] ?? "", direct)
    if (parsed === null) {
      // Non-empty but unparseable (unknown unit): keep the verbatim text and
      // surface an inline error; leave any previously committed item untouched.
      setPinnedError((e) => ({ ...e, [cat.id]: true }))
      return
    }
    setPinnedError((e) => (e[cat.id] ? { ...e, [cat.id]: false } : e))
    const value = parsed
    const total = Math.round((direct ? value : value * unitPrice) * 100) / 100
    const existing = pinnedItemByCatalog.get(cat.id)
    if (value <= 0) {
      if (existing) callbacks.removeItem(existing.id)
      setPinnedText((p) => ({ ...p, [cat.id]: "" }))
      return
    }
    const priced = direct
      ? { quantity: 1, unitPrice: total, totalPrice: total }
      : {
          quantity: value,
          unitPrice,
          totalPrice: total,
          formInputs: [{ quantity: value, unit: "h" }],
        }
    if (existing) {
      if (direct ? existing.totalPrice === total : existing.quantity === value) {
        return
      }
      callbacks.updateItem(existing.id, { ...existing, ...priced })
    } else {
      callbacks.addItem({
        id: crypto.randomUUID(),
        workshop: workshopId,
        description: cat.name,
        origin: "manual",
        type: "machine",
        catalogId: cat.id,
        variantId: variant?.id ?? "default",
        pricingModel: variant?.pricingModel ?? "time",
        ...priced,
      })
    }
  }

  const pinnedRows: PositionRow[] = pinnedCatalog.map((cat) => {
    const variant = primaryVariant(cat)
    const direct = isDirectPinned(cat)
    const unitPrice = variant ? priceForTier(variant.unitPrice, discountLevel) : 0
    const text = pinnedText[cat.id] ?? ""
    const parsed = parsePinnedValue(text, direct)
    const committed = pinnedItemByCatalog.get(cat.id)
    // While the text is unparseable, price off the last committed value so the
    // Preis/subtotal don't drop to 0 mid-correction.
    const value =
      parsed ?? (direct ? (committed?.totalPrice ?? 0) : (committed?.quantity ?? 0))
    const total = Math.round((direct ? value : value * unitPrice) * 100) / 100
    return {
      key: cat.id,
      title: cat.name,
      subtitle: null,
      menge: (
        <PinnedValueField
          value={text}
          ariaLabel={`${direct ? "Betrag" : "Stunden"} ${cat.name}`}
          suffix={direct ? "CHF" : "Std."}
          allowUnits={!direct}
          error={pinnedError[cat.id] ?? false}
          onFocus={() => {
            pinnedFocusRef.current = cat.id
          }}
          onChange={(v) => {
            setPinnedText((p) => ({ ...p, [cat.id]: v }))
            setPinnedError((e) => (e[cat.id] ? { ...e, [cat.id]: false } : e))
          }}
          onBlur={() => commitPinned(cat, unitPrice)}
        />
      ),
      kosten: direct ? "Pauschal" : `${unitPrice.toFixed(2)}/Std.`,
      preis: total.toFixed(2),
      // Always-shown input rows aren't removable via the (×); clearing the
      // field to 0 removes the underlying item instead.
      removable: false,
    }
  })

  // Subtotal tracks pinned hours live (before blur/commit) so it never lags
  // the per-row Preis. Committed pinned items are excluded from the
  // machineItems sum to avoid double-counting with `livePinnedTotal`.
  const livePinnedTotal = pinnedRows.reduce(
    (s, r) => s + (parseFloat(r.preis) || 0),
    0,
  )
  const machineTotal =
    machineItems
      .filter((i) => !(i.catalogId && pinnedIds.has(i.catalogId)))
      .reduce((s, i) => s + i.totalPrice, 0) + livePinnedTotal
  const wsTotal = machineTotal + materialTotal
  const showMachineBox =
    nfcItems.length > 0 || otherMachineRows.length > 0 || pinnedCatalog.length > 0

  return (
    <section
      className="space-y-3"
      data-testid={`workshop-block-${workshopId}`}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Colored underline = the workshop's Farbkonzept color, matching the
            dot on its add-chip so section and chip read as the same thing. */}
        <h2
          className="min-w-0 font-heading text-xl font-bold underline decoration-[3px] underline-offset-[6px] sm:text-2xl"
          style={{ textDecorationColor: workshopColor(workshopId) }}
        >
          {workshop.label}
        </h2>
        {onRemoveWorkshop && (
          <button
            type="button"
            title="Werkstatt entfernen"
            aria-label={`Werkstatt ${workshop.label} entfernen`}
            onClick={onRemoveWorkshop}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-border bg-white text-muted-foreground transition-all duration-100 hover:border-destructive hover:text-destructive"
          >
            <X className="h-[15px] w-[15px]" />
          </button>
        )}
      </div>

      {showMachineBox && (
        <div className="rounded-md border border-border bg-card shadow-sm">
          <div className="px-3 py-3 sm:px-4">
            {/* NFC (session-expandable), picker-added, and pinned manual-hour
                rows share one table so machine usage reads consistently
                regardless of how it was captured (issue #105). NFC + pinned
                rows opt out of the (×) via `removable: false`; only
                picker-added machine rows are removable. */}
            <PositionTable
              firstColLabel="Maschinen / Werkzeuge"
              rows={[...nfcRows, ...otherMachineRows, ...pinnedRows]}
              onToggle={nfcItems.length > 0 && checkoutId ? toggleNfc : undefined}
              // Only picker-added machine rows are removable; pinned/NFC rows
              // set removable:false. Omit onRemove entirely when there are
              // none so a pinned-only workshop keeps the no-gutter layout.
              onRemove={
                otherMachineRows.length > 0
                  ? (id) => callbacks.removeItem(id)
                  : undefined
              }
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
            onClick={onAddMaterial}
            className="inline-flex items-center gap-2 rounded-[3px] border border-dashed border-border px-3 py-2 text-sm font-medium text-cog-teal-dark hover:border-cog-teal hover:bg-cog-teal-light"
          >
            <Plus className="h-3.5 w-3.5" />
            Material hinzufügen
          </button>
        </div>
      </div>

      {footerSlot}

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
// step shows an always-visible input so visitors can record usage manually.
// Each pinned machine is a catalog item referenced from
// `config/pricing.workshops[ws].pinnedMachines`; the row IS the
// representation of its checkout item — entering a value upserts it,
// clearing removes it. Hourly machines take hours; direct-model machines
// (Pauschal CHF) take the amount itself (issue #555).
// ---------------------------------------------------------------------------

/** A pinned machine whose primary variant is direct-priced (Pauschal CHF):
 *  the visitor enters the amount, not hours (issue #555). */
function isDirectPinned(cat: CatalogItem): boolean {
  return primaryVariant(cat)?.pricingModel === "direct"
}

/** Digits with at most one `.`/`,` separator and decimals; empty allowed so
 *  the field can be cleared. A `type="text"` input is used deliberately:
 *  `type="number"` returns "" from `e.target.value` mid-decimal (e.g. "1."),
 *  which silently swallowed fractional hours (issue #105). Used for direct
 *  (CHF) fields, which have no unit suffix. */
const PINNED_TYPING_PATTERN = /^(?:|\d*(?:[.,]\d*)?)$/

/** Hourly fields default to hours but also accept a unit suffix
 *  ("12min", "1.5h", "90s", "0,5 std.") which `parseQuantity` converts to
 *  hours. Allows an optional trailing unit token after the number. */
const PINNED_HOURLY_TYPING_PATTERN = /^\d*(?:[.,]\d*)?\s*[a-zµ]*\.?$/i

// NOTE: this pinned-field parsing/typing/error logic deliberately parallels
// (rather than reuses) `UnitQuantityField`. The pinned field carries two modes
// UnitQuantityField doesn't: a direct/CHF (Pauschal) mode with no unit
// dimension, and tight coupling to the committed checkout item for the live
// Preis column, per-row removal on clear, and the compact in-table layout with
// an inline unit adornment. If you change unit-parsing UX, update both.
//
/** Parse a pinned field's text into its stored numeric value. Direct (CHF)
 *  fields are plain decimals; hourly fields go through `parseQuantity` so a
 *  bare number is hours and "12min"/"90s"/"1.5h" auto-convert to hours.
 *  Exact hours are stored (no rounding) — readability is handled at display
 *  time by `formatQuantity` (see the resync effect), which keeps e.g. 10 min
 *  as a clean "10 min" instead of a "0.1667" tail.
 *
 *  Returns `null` when the text is non-empty but can't be understood (unknown
 *  unit / garbage) so the caller can keep the verbatim text and flag an
 *  inline error; empty text is a valid `0` (clears the item). */
function parsePinnedValue(text: string, direct: boolean): number | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  if (direct) {
    const n = parseFloat(trimmed.replace(",", "."))
    return Number.isFinite(n) ? Math.max(0, n) : null
  }
  const hours = parseQuantity(trimmed, "h")
  if (hours == null) return null
  return hours <= 0 ? 0 : hours
}

/**
 * Editable value cell for a pinned machine (issue #105), rendered in the
 * shared PositionTable's Menge column so it lines up with NFC machine rows
 * (which show "X Min") and material rows. Controlled by WorkshopInlineSection
 * — the Preis column reflects the live value — and commits on blur. Accepts
 * decimals (e.g. 1.5 hours, 12.50 CHF); `suffix` names the unit ("Std." for
 * hourly machines, "CHF" for direct-priced ones).
 */
function PinnedValueField({
  value,
  ariaLabel,
  suffix,
  allowUnits,
  error,
  onFocus,
  onChange,
  onBlur,
}: {
  value: string
  ariaLabel: string
  suffix: string
  /** Hourly fields accept a unit suffix ("12min"); CHF fields stay numeric. */
  allowUnits: boolean
  /** Text is non-empty but couldn't be parsed — red border + inline hint. */
  error: boolean
  onFocus: () => void
  onChange: (v: string) => void
  onBlur: () => void
}) {
  const typingPattern = allowUnits
    ? PINNED_HOURLY_TYPING_PATTERN
    : PINNED_TYPING_PATTERN
  // The fixed unit sits *inside* the box as the default-unit hint. Hide it
  // while the user is typing their own unit token so "12min" and "Std." don't
  // contradict each other (the value normalises back to hours on blur).
  const showUnit = !/[a-zµ]/i.test(value)
  return (
    // Fixed width + whitespace-normal so the error badge wraps here instead of
    // stretching the auto-width, nowrap Menge column. The "…12min, 1.5h"
    // example lives in the box's persistent Tipp hint, so this badge stays
    // terse.
    <span className="inline-flex w-32 flex-col items-end gap-0.5 whitespace-normal">
      <span
        className={`inline-flex h-8 w-24 items-center rounded-[3px] border bg-background px-2 ${
          error
            ? "border-[#cc2a24]"
            : "border-[#ccc] focus-within:border-cog-teal"
        }`}
      >
        <input
          type="text"
          inputMode={allowUnits ? "text" : "decimal"}
          value={value}
          aria-label={ariaLabel}
          aria-invalid={error || undefined}
          placeholder="0"
          onFocus={onFocus}
          onChange={(e) => {
            const raw = e.target.value
            if (!typingPattern.test(raw)) return
            onChange(raw)
          }}
          onBlur={onBlur}
          className="min-w-0 flex-1 bg-transparent text-right text-base md:text-sm tabular-nums text-foreground outline-none"
        />
        {!error && showUnit ? (
          <span className="ml-1 shrink-0 text-xs text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </span>
      {error ? <ErrorBadge message="Einheit unbekannt" /> : null}
    </span>
  )
}
