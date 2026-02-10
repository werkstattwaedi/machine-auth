// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

const STEPS = [
  { label: "Check In" },
  { label: "Kosten" },
  { label: "Check Out" },
]

interface CheckoutProgressProps {
  currentStep: number // 0-based
}

export function CheckoutProgress({ currentStep }: CheckoutProgressProps) {
  return (
    <div className="flex items-center justify-between mb-8">
      {STEPS.map((step, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors",
                i < currentStep
                  ? "bg-primary border-primary text-primary-foreground"
                  : i === currentStep
                    ? "border-primary text-primary"
                    : "border-muted-foreground/30 text-muted-foreground/50"
              )}
            >
              {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={cn(
                "text-xs mt-1",
                i <= currentStep
                  ? "text-foreground font-medium"
                  : "text-muted-foreground/50"
              )}
            >
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                "flex-1 h-0.5 mx-2 mt-[-1rem]",
                i < currentStep ? "bg-primary" : "bg-muted-foreground/20"
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}
