// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { formatCHF } from "@modules/lib/format"
import { PositionTable, rowFromItem } from "./position-table"
import type { CheckoutItemLocal } from "./inline-rows"

/**
 * Vereinsmitgliedschaft block for the workshops step (issue #262/#263).
 * Mirrors {@link WorkshopInlineSection}'s heading + card + Zwischentotal
 * rhythm so it reads as a peer of the other workshop sessions (the human
 * asked for it "inline with the other workshop sessions"), and has no
 * "Material hinzufügen" affordance — a membership is purchased on
 * /membership and you can't add material to it.
 *
 * When an `onRemove` callback is supplied (issue #362), each membership
 * line gets a (×) remove affordance so a membership accidentally added
 * mid-visit can be dropped straight from the wizard instead of forcing
 * the user back to the /membership escape hatch.
 */
export function MembershipInlineSection({
  items,
  onRemove,
}: {
  items: CheckoutItemLocal[]
  /** Remove a membership line item by its checkout-item id (issue #362). */
  onRemove?: (itemId: string) => void
}) {
  const total = items.reduce((s, i) => s + i.totalPrice, 0)

  return (
    <section className="space-y-3" data-testid="membership-block">
      <h2 className="font-heading text-xl font-bold sm:text-2xl">
        Vereinsmitgliedschaft
      </h2>

      <div className="rounded-md border border-border bg-card shadow-sm">
        <div className="px-3 py-3 sm:px-4">
          <PositionTable
            firstColLabel="Mitgliedschaft"
            rows={items.map(rowFromItem)}
            onRemove={onRemove}
          />
        </div>
      </div>

      <div className="flex items-baseline justify-between px-1 pt-1 text-sm">
        <span className="text-muted-foreground">
          Zwischentotal Vereinsmitgliedschaft
        </span>
        <span className="font-heading text-base font-bold tabular-nums">
          {formatCHF(total)}
        </span>
      </div>
    </section>
  )
}
