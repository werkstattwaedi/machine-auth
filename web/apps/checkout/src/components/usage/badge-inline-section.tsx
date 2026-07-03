// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Nfc } from "lucide-react"
import { formatCHF } from "@modules/lib/format"
import { PositionTable, rowFromItem } from "./position-table"
import type { CheckoutItemLocal } from "./inline-rows"

/**
 * Selbstbedienungs-Badge block for the workshops step. Mirrors
 * {@link MembershipInlineSection}'s heading + card + Zwischentotal rhythm.
 * Badge line items are appended server-side (addBadgeToCheckout) when an
 * unregistered badge is tapped on the kiosk reader; each line gets a (×)
 * remove affordance — nothing is associated until checkout close, so
 * removal needs no unwinding.
 *
 * With `showCta` (kiosk, identified visitor) a hint row invites tapping a
 * new badge on the reader — that tap opens the purchase dialog.
 */
export function BadgeInlineSection({
  items,
  onRemove,
  showCta = false,
}: {
  items: CheckoutItemLocal[]
  /** Remove a badge line item by its checkout-item id. */
  onRemove?: (itemId: string) => void
  /** Show the "tap a new badge" invitation (kiosk + identified only). */
  showCta?: boolean
}) {
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  return (
    <section className="space-y-3" data-testid="badge-block">
      <h2 className="font-heading text-xl font-bold sm:text-2xl">Badge</h2>

      <div className="rounded-md border border-border bg-card shadow-sm">
        {items.length > 0 && (
          <div className="px-3 py-3 sm:px-4">
            <PositionTable
              firstColLabel="Badge"
              rows={items.map(rowFromItem)}
              onRemove={onRemove}
            />
          </div>
        )}
        {showCta && (
          <div
            className={`flex items-center gap-3 px-3 py-3 sm:px-4 text-sm text-muted-foreground ${
              items.length > 0 ? "border-t border-border" : ""
            }`}
            data-testid="badge-cta"
          >
            <Nfc className="h-5 w-5 shrink-0 text-cog-teal" aria-hidden />
            <span>
              Badge kaufen? Lege einen neuen Badge auf den Leser — der erste
              Badge ist für Mitglieder und Kursabsolvent:innen gratis.
            </span>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex items-baseline justify-between px-1 pt-1 text-sm">
          <span className="text-muted-foreground">Zwischentotal Badge</span>
          <span className="font-heading text-base font-bold tabular-nums">
            {formatCHF(total)}
          </span>
        </div>
      )}
    </section>
  )
}
