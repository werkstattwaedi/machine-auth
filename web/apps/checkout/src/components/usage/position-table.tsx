// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { CircleX } from "lucide-react"
import { getShortUnit } from "@modules/lib/workshop-config"
import type { CheckoutItemLocal } from "./inline-rows"

export interface PositionRow {
  key: string
  title: string
  /** Optional sub-line under the title (e.g. raw form input "60×40 cm"). */
  subtitle: string | null
  menge: string
  kosten: string
  preis: string
}

/**
 * 4-column position table used for both Maschinen-/Werkzeugnutzung and
 * Materialbezug line items, on the Werkstätten step (per-workshop) and the
 * Check-Out step (mixed sections). Title column on the left (with optional
 * muted subtitle), Menge / Kosten / Preis right-aligned. CHF prefix is
 * intentionally omitted — the section total/subtotal already shows the
 * currency once.
 *
 * The whole table is a single CSS grid so columns line up across rows
 * (each row uses `display: contents` to let its cells become direct grid
 * items of the parent). When `onRemove` is provided, an extra trailing
 * column shows a hover-revealed × button (always visible on touch).
 */
export function PositionTable({
  firstColLabel,
  rows,
  onRemove,
}: {
  firstColLabel: string
  rows: PositionRow[]
  onRemove?: (key: string) => void
}) {
  const cols = onRemove
    ? "grid-cols-[20px_minmax(0,1fr)_auto_auto_auto]"
    : "grid-cols-[minmax(0,1fr)_auto_auto_auto]"
  return (
    <div
      role="table"
      className={`grid ${cols} items-baseline gap-x-4 sm:gap-x-6`}
    >
      <div role="row" className="contents">
        {onRemove && <span aria-hidden className="pb-1.5" />}
        <span
          role="columnheader"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pb-1.5"
        >
          {firstColLabel}
        </span>
        {/* Right-aligned headers intentionally drop `tracking-wider`: with
            text-right, the trailing letter-spacing of tracking would push
            the visible text leftward inside the cell box, leaving the
            header text visually inset from the value columns below. */}
        <span
          role="columnheader"
          className="text-[11px] font-semibold uppercase text-muted-foreground text-right pb-1.5"
        >
          Menge
        </span>
        <span
          role="columnheader"
          className="text-[11px] font-semibold uppercase text-muted-foreground text-right pb-1.5"
        >
          Kosten
        </span>
        <span
          role="columnheader"
          className="text-[11px] font-semibold uppercase text-muted-foreground text-right pb-1.5"
        >
          Preis
        </span>
      </div>
      {rows.map((row) => (
        <div key={row.key} role="row" className="contents">
          {onRemove && (
            // Intentionally no `border-t` here: the dotted row separator
            // shouldn't extend into the remove gutter — the (×) button reads
            // cleaner against unbroken whitespace.
            <span role="cell" className="py-2 flex items-start">
              <button
                type="button"
                onClick={() => onRemove(row.key)}
                aria-label="Entfernen"
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 hover:text-destructive focus-visible:text-destructive focus-visible:outline-2 focus-visible:outline-cog-teal/40 focus-visible:outline-offset-1"
              >
                <CircleX className="h-4 w-4" strokeWidth={1.6} />
              </button>
            </span>
          )}
          <span
            role="cell"
            className="py-2 text-sm border-t border-dotted border-border min-w-0"
          >
            <span className="text-foreground block truncate">{row.title}</span>
            {row.subtitle && (
              <span className="block text-xs text-muted-foreground/80 font-light tabular-nums">
                {row.subtitle}
              </span>
            )}
          </span>
          <span
            role="cell"
            className="py-2 text-sm text-muted-foreground tabular-nums text-right whitespace-nowrap border-t border-dotted border-border"
          >
            {row.menge}
          </span>
          <span
            role="cell"
            className="py-2 text-sm text-muted-foreground tabular-nums text-right whitespace-nowrap border-t border-dotted border-border"
          >
            {row.kosten}
          </span>
          <span
            role="cell"
            className="py-2 text-sm font-semibold tabular-nums text-right min-w-[60px] border-t border-dotted border-border"
          >
            {row.preis}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row formatters — turn a CheckoutItemLocal into the strings expected by
// PositionTable. Kept here so callers don't have to duplicate the per-
// pricing-model branching.
// ---------------------------------------------------------------------------

/** Raw form input shown left-aligned under the description (e.g. "60×40 cm",
 *  "100 g"). Returns "" when the natural quantity already equals the form
 *  input (no extra info to surface). */
export function formatRawSize(item: CheckoutItemLocal): string {
  const pm = item.pricingModel
  if (!pm || pm === "direct") return ""
  if (pm === "sla") {
    const ml = item.formInputs?.[0]?.quantity ?? 0
    const layers = item.formInputs?.[1]?.quantity ?? 0
    return `${ml} ml · ${layers} Layer`
  }
  if (pm === "area" && item.formInputs?.length === 2) {
    const [l, w] = item.formInputs
    return `${l.quantity}×${w.quantity} ${l.unit}`
  }
  if (pm === "weight" && item.formInputs?.[0]) {
    return `${item.formInputs[0].quantity} ${item.formInputs[0].unit}`
  }
  if (pm === "length" && item.formInputs?.[0]) {
    return `${item.formInputs[0].quantity} ${item.formInputs[0].unit}`
  }
  // count items don't need a separate raw-size line — the qty + unit-price
  // line on the right ("3 Stk. × CHF 2.00") already conveys it.
  return ""
}

/** "Menge" column content — natural-unit quantity (e.g. "0.25 m²", "3 Stk.",
 *  "12 Min" for time). Returns "" for direct/SLA where this column doesn't
 *  apply. */
export function formatMenge(item: CheckoutItemLocal): string {
  const pm = item.pricingModel
  if (!pm || pm === "direct") return ""
  if (pm === "sla") {
    const ml = item.formInputs?.[0]?.quantity ?? 0
    const layers = item.formInputs?.[1]?.quantity ?? 0
    return `${ml} ml · ${layers} L`
  }
  if (pm === "time") {
    return `${Math.round(item.quantity * 60)} Min`
  }
  return `${formatBaseQty(item.quantity)} ${getShortUnit(pm)}`
}

/** "Kosten" column — unit price with `/unit` suffix, no CHF prefix
 *  (e.g. "51.65/m²", "2.00/Stk."). SLA: empty (two-axis price). */
export function formatKosten(item: CheckoutItemLocal): string {
  const pm = item.pricingModel
  if (!pm || pm === "direct" || pm === "sla") return ""
  return `${item.unitPrice.toFixed(2)}/${getShortUnit(pm)}`
}

function formatBaseQty(qty: number): string {
  return qty === Math.floor(qty) ? String(qty) : qty.toFixed(2)
}

/** Convenience: shape a CheckoutItemLocal into a PositionRow using the
 *  standard formatters. Callers that need different formatting (e.g. NFC
 *  machine rows showing minutes/h instead of pricingModel-derived units)
 *  can build the PositionRow themselves. */
export function rowFromItem(item: CheckoutItemLocal): PositionRow {
  return {
    key: item.id,
    title: item.description,
    subtitle: formatRawSize(item) || null,
    menge: formatMenge(item),
    kosten: formatKosten(item),
    preis: item.totalPrice.toFixed(2),
  }
}
