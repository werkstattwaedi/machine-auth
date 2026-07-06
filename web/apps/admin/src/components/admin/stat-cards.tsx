// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Compact summary-stat strip (label over value) used at the top of the
// Rechnungen / import pages. Purely presentational.

export interface StatCard {
  label: string
  value: string | number
  /** Tailwind text color class for the value, e.g. "text-destructive". */
  tone?: string
  /** Small print under the value. */
  hint?: string
}

export function StatCards({ cards }: { cards: StatCard[] }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border bg-card px-4 py-3 shadow-sm"
        >
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div
            className={`font-heading text-xl font-bold tabular-nums ${c.tone ?? ""}`}
          >
            {c.value}
          </div>
          {c.hint && (
            <div className="text-xs text-muted-foreground">{c.hint}</div>
          )}
        </div>
      ))}
    </div>
  )
}
