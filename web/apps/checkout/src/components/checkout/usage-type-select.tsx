// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { ChevronDown, Info } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"
import {
  USAGE_TYPE_INFO,
  USAGE_TYPE_LABELS,
  usageTypeOptions,
  type UsageType,
} from "@modules/lib/pricing"
import { cn } from "@modules/lib/utils"

interface UsageTypeSelectProps {
  id: string
  value: UsageType
  onChange: (t: UsageType) => void
  /** Anonymous checkouts never see the account-only types (issue #570). */
  anonymous: boolean
  /**
   * The cart holds a machine item (`isMachineItem`). „Nur Materialbezug" is
   * then shown disabled with the reason (issue #628) — the server rejects
   * that combination, so offering it only leads to a failed submit.
   */
  hasMachineUsage: boolean
}

/**
 * The Nutzungsart control of the checkout summary (issue #570, design
 * variant 2a). One compact field that, once opened, explains every usage
 * type: its price effect and who it applies to. Below the field, a gold
 * note spells out what the visitor declares by choosing a discount — the
 * discounts are self-declared and spot-checked, so the declaration must be
 * visible without another click.
 *
 * Built on the Radix Select primitive directly (not the shadcn wrapper)
 * because each option is three lines, the trigger two, and the design
 * carries no check indicator — the wrapper's single-line item layout does
 * not fit. Keyboard navigation, outside-click and Escape dismissal come
 * from the primitive.
 */
export function UsageTypeSelect({
  id,
  value,
  onChange,
  anonymous,
  hasMachineUsage,
}: UsageTypeSelectProps) {
  const options = usageTypeOptions({
    anonymous,
    current: value,
    hasMachineUsage,
  })
  const current = USAGE_TYPE_INFO[value]

  return (
    <div className="flex flex-col gap-1.5">
      <SelectPrimitive.Root
        value={value}
        onValueChange={(v) => onChange(v as UsageType)}
      >
        <SelectPrimitive.Trigger
          id={id}
          data-testid="usage-type-trigger"
          className={cn(
            "group grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-[6px] border border-border bg-white px-[13px] py-2.5 text-left shadow-xs outline-none transition-[border-color,box-shadow]",
            "data-[state=open]:border-cog-teal data-[state=open]:ring-[3px] data-[state=open]:ring-cog-teal/30",
            "focus-visible:border-cog-teal focus-visible:ring-[3px] focus-visible:ring-cog-teal/30",
          )}
        >
          <SelectPrimitive.Value>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="truncate text-sm font-semibold text-foreground">
                {USAGE_TYPE_LABELS[value]}
              </span>
              {current.effect && (
                <span className="truncate text-[12.5px] text-cog-teal-dark">
                  {current.effect}
                </span>
              )}
            </span>
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <ChevronDown
              className="size-[18px] text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-50 w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] overflow-hidden rounded-[6px] border border-cog-teal bg-white text-foreground shadow-[0_10px_15px_-3px_rgb(0_0_0/0.12),0_4px_6px_-4px_rgb(0_0_0/0.1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
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
                      // The reason replaces the price effect: a waiver the
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

      {current.declaration && (
        <div
          data-testid="usage-type-declaration"
          className="mt-1 flex items-start gap-[9px] rounded-[6px] border border-oww-gold-border bg-oww-gold-light px-[13px] py-[11px] text-[13px] leading-normal text-oww-gold-text"
        >
          <Info
            className="mt-0.5 size-[15px] flex-none text-oww-gold-dark"
            aria-hidden
          />
          <span className="text-pretty">{current.declaration}</span>
        </div>
      )}
    </div>
  )
}
