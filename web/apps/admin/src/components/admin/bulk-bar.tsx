// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Teal selection bar shown above tables while rows are ticked. Holds the
// selection summary on the left and bulk actions on the right — the lists
// themselves stay action-light (row click = open the record).

import type { ReactNode } from "react"

export function BulkBar({
  label,
  children,
}: {
  /** Selection summary, e.g. "2 ausgewählt · CHF 144". */
  label: string
  /** Bulk action buttons. */
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-cog-teal/30 bg-cog-teal-light px-3.5 py-2">
      <span className="flex-1 text-[13px] font-semibold text-cog-teal-dark">
        {label}
      </span>
      {children}
    </div>
  )
}
