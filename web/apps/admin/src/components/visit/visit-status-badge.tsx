// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Badge } from "@modules/components/ui/badge"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"

/** offen / abgerechnet / storniert (ADR-0041) — shared by list and detail. */
export function VisitStatusBadge({ status }: { status: CheckoutDoc["status"] }) {
  if (status === "open") {
    return (
      <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
        offen
      </Badge>
    )
  }
  if (status === "cancelled") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        storniert
      </Badge>
    )
  }
  return <Badge variant="secondary">abgerechnet</Badge>
}
