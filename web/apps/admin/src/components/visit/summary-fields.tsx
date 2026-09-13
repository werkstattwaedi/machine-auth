// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// One cell of the Abrechnung grid on a Besuch. With `previous` set (the
// correction editor's estimate, ADR-0042) it reads "Bisher X → Neu Y".

import { formatCHF } from "@modules/lib/format"
import { MoveRight } from "lucide-react"

export function SummaryField({
  label,
  value,
  bold,
  previous,
}: {
  label: string
  value: number
  bold?: boolean
  /** Amount before the correction; rendered only when it differs. */
  previous?: number | null
}) {
  const changed = previous != null && Math.abs(previous - value) > 0.005
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${bold ? "font-bold" : ""}`}>
        {changed ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground line-through">
              {formatCHF(previous)}
            </span>
            <MoveRight className="h-3 w-3 text-muted-foreground" />
            <span>{formatCHF(value)}</span>
          </span>
        ) : (
          formatCHF(value)
        )}
      </div>
    </div>
  )
}
