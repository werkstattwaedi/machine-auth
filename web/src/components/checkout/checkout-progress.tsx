// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils"

const STEPS = [
  { label: "1. Check In" },
  { label: "2. Kosten Werkstätten" },
  { label: "3. Check Out" },
]

interface CheckoutProgressProps {
  currentStep: number // 0-based
}

export function CheckoutProgress({ currentStep }: CheckoutProgressProps) {
  return (
    <div className="mb-10">
      <div className="flex gap-2">
        {STEPS.map((step, i) => (
          <div key={i} className="flex-1 flex flex-col">
            <div
              className={cn(
                "h-[3px] mb-2 transition-colors",
                i <= currentStep ? "bg-cog-teal" : "bg-[#ccc]"
              )}
            />
            <span
              className={cn(
                "text-sm",
                i === currentStep
                  ? "text-foreground font-semibold"
                  : i < currentStep
                    ? "text-cog-teal font-medium"
                    : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
