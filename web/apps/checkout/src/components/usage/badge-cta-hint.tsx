// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Nfc } from "lucide-react"

/**
 * Kiosk hint inviting the visitor to tap a new self-service badge on the
 * reader — the tap opens the purchase dialog (see BridgeNfcRouter /
 * BadgeOfferCoordinator), which appends the badge as an ordinary `diverses`
 * line item.
 *
 * Issue #505: this used to be a standalone "Badge" block rendered right
 * under the workshop picker for every identified kiosk visitor, which read
 * as too intrusive. It now lives nested inside the Diverses workshop
 * section, so the instructions only surface once the visitor opens Diverses
 * — which is where the badge SKU is bucketed anyway.
 */
export function BadgeCtaHint() {
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-3 text-sm text-muted-foreground shadow-sm sm:px-4"
      data-testid="badge-cta"
    >
      <Nfc className="h-5 w-5 shrink-0 text-cog-teal" aria-hidden />
      <span>
        Badge kaufen? Lege einen neuen Badge auf den Leser — der erste Badge
        ist für Mitglieder und Kursabsolvent:innen gratis.
      </span>
    </div>
  )
}
