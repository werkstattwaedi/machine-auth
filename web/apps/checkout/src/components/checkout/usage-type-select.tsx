// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { ChevronDown } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"
import {
  USAGE_TYPE_INFO,
  USAGE_TYPE_LABELS,
  personUsageOptions,
  type UsageType,
} from "@modules/lib/pricing"
import { cn } from "@modules/lib/utils"

interface UsageTypeSelectProps {
  id: string
  value: UsageType
  onChange: (t: UsageType) => void
  /** Guest check-in: nobody is offered the owner-only types (CHK-32). */
  anonymous: boolean
  /**
   * The identified person's own line — the only one that offers
   * Freiwilligengruppe / Interne Nutzung (issue #605).
   */
  isOwner: boolean
  /** Anyone else is on the visit: the owner-only types show disabled. */
  othersPresent: boolean
  /** Accessible name when no `<label htmlFor>` points at the trigger. */
  ariaLabel?: string
}

/**
 * One person's Nutzungsart on the check-in (issues #570, #605). A compact
 * field showing only the label; opened, every option explains its price
 * effect and who it is for. Owner-only types come last and, while others
 * are on the visit, stay visible but disabled with the reason.
 *
 * Built on the Radix Select primitive directly (not the shadcn wrapper)
 * because each option is three lines and the design carries no check
 * indicator — the wrapper's single-line item layout does not fit.
 * Keyboard navigation, outside-click and Escape dismissal come from the
 * primitive.
 */
export function UsageTypeSelect({
  id,
  value,
  onChange,
  anonymous,
  isOwner,
  othersPresent,
  ariaLabel,
}: UsageTypeSelectProps) {
  const options = personUsageOptions({
    isOwner,
    anonymous,
    othersPresent,
    current: value,
  })

  return (
    <div className="flex flex-col gap-1.5">
      <SelectPrimitive.Root
        value={value}
        onValueChange={(v) => onChange(v as UsageType)}
      >
        <SelectPrimitive.Trigger
          id={id}
          aria-label={ariaLabel}
          data-testid="usage-type-trigger"
          className={cn(
            "group grid h-[34px] w-full grid-cols-[1fr_auto] items-center gap-3 rounded-[6px] border border-border bg-white px-3 text-left shadow-xs outline-none transition-[border-color,box-shadow]",
            "data-[state=open]:border-cog-teal data-[state=open]:ring-[3px] data-[state=open]:ring-cog-teal/30",
            "focus-visible:border-cog-teal focus-visible:ring-[3px] focus-visible:ring-cog-teal/30",
          )}
        >
          <SelectPrimitive.Value>
            <span className="block truncate text-sm font-semibold text-foreground">
              {USAGE_TYPE_LABELS[value]}
            </span>
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <ChevronDown
              className="size-[16px] text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-50 w-[var(--radix-select-trigger-width)] min-w-[280px] max-h-[var(--radix-select-content-available-height)] overflow-hidden rounded-[6px] border border-cog-teal bg-white text-foreground shadow-[0_10px_15px_-3px_rgb(0_0_0/0.12),0_4px_6px_-4px_rgb(0_0_0/0.1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          >
            <SelectPrimitive.Viewport className="overflow-y-auto">
              {options.map(({ type: t, disabledReason }) => {
                const info = USAGE_TYPE_INFO[t]
                return (
                  <SelectPrimitive.Item
                    key={t}
                    value={t}
                    disabled={disabledReason !== undefined}
                    className="flex w-full cursor-pointer select-none flex-col gap-0.5 border-b border-border px-3.5 py-[11px] text-left outline-none last:border-b-0 data-[highlighted]:bg-[#f0fbfc] data-[state=checked]:bg-cog-teal-light data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
                  >
                    <SelectPrimitive.ItemText>
                      <span className="text-sm font-semibold">
                        {USAGE_TYPE_LABELS[t]}
                      </span>
                    </SelectPrimitive.ItemText>
                    {disabledReason ? (
                      // The reason replaces the price effect: a type the
                      // visitor cannot pick is not worth advertising.
                      <span
                        data-testid="usage-type-disabled-reason"
                        className="text-[12.5px] leading-[1.4] text-muted-foreground"
                      >
                        {disabledReason}
                      </span>
                    ) : (
                      info.effect && (
                        <span className="text-[12.5px] leading-[1.4] text-cog-teal-dark">
                          {info.effect}
                        </span>
                      )
                    )}
                    <span className="text-[12.5px] leading-[1.45] text-muted-foreground text-pretty">
                      {info.appliesTo}
                    </span>
                  </SelectPrimitive.Item>
                )
              })}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  )
}
