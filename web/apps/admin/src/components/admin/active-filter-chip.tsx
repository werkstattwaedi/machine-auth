// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Removable pre-applied filter chip ("Person: Mike Schneider ✕") shown on
// the shared list pages when they're reached through a deep link from a
// person/machine page. Removing the chip widens the list to everyone.

import { X } from "lucide-react"

export function ActiveFilterChip({
  label,
  value,
  onRemove,
}: {
  /** Filter dimension, e.g. "Person" or "Maschine". */
  label: string
  /** Resolved display value, e.g. the person's name. */
  value: string
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1 text-[13px] font-medium text-primary-foreground hover:opacity-90"
      aria-label={`Filter ${label}: ${value} entfernen`}
    >
      {label}: {value}
      <X className="h-3.5 w-3.5" />
    </button>
  )
}
