// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { Timestamp } from "firebase/firestore"

/**
 * Human-compact duration between two usage timestamps: "1h 20m", "45m".
 * Returns "–" when either end is missing (usage still running or legacy
 * record without an endTime).
 */
export function formatDuration(
  start: Timestamp | undefined | null,
  end: Timestamp | undefined | null,
): string {
  if (!start || !end) return "–"
  const ms = end.toMillis() - start.toMillis()
  if (ms < 0) return "–"
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${String(minutes).padStart(2, "0")}m`
}
