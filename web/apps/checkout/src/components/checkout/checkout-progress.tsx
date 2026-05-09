// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { cn } from "@modules/lib/utils"

const STEPS = [
  { label: "1. Check In" },
  { label: "2. Kosten Werkstätten" },
  { label: "3. Check Out" },
  { label: "4. Bezahlen" },
]

interface CheckoutProgressProps {
  currentStep: number // 0-based
}

export function CheckoutProgress({ currentStep }: CheckoutProgressProps) {
  return (
    <div className="mb-10">
      <div className="flex gap-2">
        {STEPS.map((step, i) => {
          const done = i < currentStep
          const current = i === currentStep
          return (
            <div key={i} className="flex-1 flex flex-col">
              <div
                className={cn(
                  "h-[3px] mb-2 transition-colors",
                  current
                    ? "bg-cog-teal"
                    : done
                      ? "bg-cog-teal-dark"
                      : "bg-[#ccc]"
                )}
              />
              <span
                className={cn(
                  "text-xs sm:text-sm",
                  current
                    ? "text-foreground font-semibold"
                    : done
                      ? "text-foreground"
                      : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
