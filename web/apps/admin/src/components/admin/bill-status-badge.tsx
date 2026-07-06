// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Badge } from "@modules/components/ui/badge"
import type { BillStatus } from "@/lib/bill-status"

const STATUS_BADGE: Record<
  BillStatus,
  {
    label: string
    className?: string
    variant?: "secondary" | "destructive" | "outline"
  }
> = {
  paid: { label: "bezahlt", variant: "secondary" },
  open: {
    label: "offen",
    className: "bg-oww-gold-light text-oww-gold-text border-oww-gold-border",
  },
  overdue: { label: "überfällig", variant: "destructive" },
  beleg: { label: "Beleg", variant: "outline" },
}

export function BillStatusBadge({ status }: { status: BillStatus }) {
  const cfg = STATUS_BADGE[status]
  return (
    <Badge variant={cfg.variant} className={cfg.className}>
      {cfg.label}
    </Badge>
  )
}
