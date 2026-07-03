// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Check } from "lucide-react"
import { cn } from "@modules/lib/utils"

const STEPS = [
  { label: "Check In" },
  { label: "Kosten" },
  { label: "Check Out" },
  { label: "Bezahlen" },
]

interface CheckoutProgressProps {
  currentStep: number // 0-based
}

export function CheckoutProgress({ currentStep }: CheckoutProgressProps) {
  return (
    <div className="mb-10">
      <div className="flex gap-1.5 sm:gap-2">
        {STEPS.map((step, i) => {
          const done = i < currentStep
          const current = i === currentStep
          const active = done || current
          return (
            <div
              key={i}
              className="flex-1 flex flex-col"
              aria-current={current ? "step" : undefined}
            >
              <div
                className={cn(
                  "h-[3px] mb-2.5 rounded-full transition-colors",
                  active ? "bg-cog-teal" : "bg-[#d8d8d8]",
                )}
              />
              <div className="flex items-start gap-2 sm:gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold leading-none text-white shrink-0",
                    active ? "bg-cog-teal" : "bg-[#c9c9c9]",
                  )}
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-xs sm:text-sm leading-tight",
                    current
                      ? "font-semibold text-foreground"
                      : done
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
