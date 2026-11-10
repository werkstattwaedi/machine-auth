// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * A small radio group as segmented buttons (Nein / Vorläufig / Ja, Nein / Ja):
 * one tab stop, arrow keys move and select, as the ARIA radio-group pattern
 * asks.
 */

import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@modules/lib/utils"

export interface SegmentedOption<T extends string | boolean> {
  value: T
  label: ReactNode
  hint?: string
  /** Class for the selected state (colour). */
  selectedClassName?: string
}

export function SegmentedChoice<T extends string | boolean>({
  label,
  options,
  value,
  onChange,
  disabled,
  className,
  title,
}: {
  label: string
  options: ReadonlyArray<SegmentedOption<T>>
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  title?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const current = Math.max(0, options.findIndex((o) => o.value === value))

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      title={title}
      className={cn("grid gap-1 rounded-xl bg-muted p-1", disabled && "opacity-60", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o, i) => {
        const selected = o.value === value
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === current ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "flex min-w-16 flex-col items-center rounded-lg px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected ? cn("bg-card font-semibold shadow-xs", o.selectedClassName) : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
            {o.hint && <span className="text-xs font-normal text-muted-foreground">{o.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
