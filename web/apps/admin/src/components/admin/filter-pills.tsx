// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Rounded status-filter pills used across the workflow list pages
// (Personen, Maschinen, Rechnungen, Besuche, …). Single-select; the
// active pill renders solid-primary, matching the admin design kit.

export interface FilterPillOption<V extends string> {
  value: V
  label: string
  /** Optional count badge rendered after the label. */
  count?: number
}

export function FilterPills<V extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterPillOption<V>[]
  value: V
  onChange: (value: V) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={
              "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors " +
              (active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-accent")
            }
          >
            {opt.label}
            {opt.count != null && (
              <span className={active ? "ml-1.5 opacity-80" : "ml-1.5 text-muted-foreground"}>
                {opt.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
