// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One participant × Termin cell of the course page (#842, CRS-4): the
 * edoobox Präsenzstatus as its symbol in its colour on a light tint, hatched
 * while nothing is recorded. A click opens the statuses on offer plus
 * «Kein Status»; future Termine can't be set.
 */

import { Check } from "lucide-react"
import type { AttendanceStatus } from "@oww/shared"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@modules/components/ui/dropdown-menu"
import { cn } from "@modules/lib/utils"

const NO_STATUS = 0

/** Symbol in the edoobox colour, darkened toward the text colour so yellow stays readable. */
export function statusStyle(color: string): React.CSSProperties {
  return {
    ["--st" as string]: color,
    background: "color-mix(in srgb, var(--st) 16%, var(--color-card))",
    color: "color-mix(in srgb, var(--st) 72%, var(--color-foreground))",
  }
}

export function StatusChip({ status, className }: { status: AttendanceStatus; className?: string }) {
  return (
    <span
      className={cn("grid size-7 shrink-0 place-items-center rounded-md text-base font-semibold leading-none", className)}
      style={statusStyle(status.color)}
      aria-hidden="true"
    >
      {status.symbol}
    </span>
  )
}

export interface AttendanceCellProps {
  /** e.g. «Luca Meier» — for the labels. */
  personName: string
  dateLabel: string
  /** Recorded status number, absent when none. */
  value: number | undefined
  /** Every status edoobox defines (to show one set there, even if not on offer). */
  allStatuses: readonly AttendanceStatus[]
  offeredStatuses: readonly AttendanceStatus[]
  /** Not started yet (CRS-4) or the course is closed (CRS-15). */
  disabled: boolean
  future: boolean
  onSet: (status: number) => void
}

export function AttendanceCell({
  personName,
  dateLabel,
  value,
  allStatuses,
  offeredStatuses,
  disabled,
  future,
  onSet,
}: AttendanceCellProps) {
  const current = value !== undefined && value !== NO_STATUS ? allStatuses.find((s) => s.status === value) : undefined
  const noStatus = allStatuses.find((s) => s.status === NO_STATUS) ?? {
    status: NO_STATUS,
    name: "Kein Status",
    symbol: "●",
    color: "#000000",
    attendancePct: 0,
  }
  const label = `${personName} am ${dateLabel}: ${future ? "noch nicht" : current?.name ?? "kein Status"}`
  const cell = (
    <button
      type="button"
      aria-label={label}
      title={future ? undefined : current?.name ?? "Kein Status"}
      disabled={disabled}
      className={cn(
        "grid size-full min-h-16 place-items-center text-[22px] font-semibold leading-none outline-none",
        "enabled:hover:ring-2 enabled:hover:ring-inset enabled:hover:ring-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
        "data-[state=open]:ring-2 data-[state=open]:ring-inset data-[state=open]:ring-primary",
        !current && !future && "bg-[repeating-linear-gradient(-45deg,var(--color-muted)_0_6px,var(--color-card)_6px_12px)]",
        !current && future && "bg-muted",
        disabled && "cursor-default"
      )}
      style={current && !future ? statusStyle(current.color) : undefined}
    >
      {current && !future ? current.symbol : null}
    </button>
  )
  if (disabled) return cell
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{cell}</DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {personName} · {dateLabel}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(value ?? NO_STATUS)} onValueChange={(v) => onSet(Number(v))}>
          {offeredStatuses.map((s) => (
            <StatusItem key={s.status} status={s} selected={value === s.status} />
          ))}
          <DropdownMenuSeparator />
          <StatusItem status={noStatus} selected={!current} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StatusItem({ status, selected }: { status: AttendanceStatus; selected: boolean }) {
  return (
    <DropdownMenuRadioItem value={String(status.status)} className="gap-2.5 py-2 pl-2 [&>span:first-child]:hidden">
      <StatusChip status={status} />
      <span className={cn("flex-1", selected && "font-semibold")}>{status.name}</span>
      {selected && <Check className="size-4 text-primary" aria-hidden="true" />}
    </DropdownMenuRadioItem>
  )
}
