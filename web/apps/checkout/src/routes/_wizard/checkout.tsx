// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { StepCheckout } from "@/components/checkout/step-checkout"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { NoCheckoutGate } from "@/components/checkout/no-checkout-gate"

export const Route = createFileRoute("/_wizard/checkout")({
  component: CheckoutRoute,
})

function CheckoutRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()

  // C4 guard: /checkout requires an open checkout. Bare navigation here
  // shows a dialog offering /checkin instead of an empty review screen.
  if (!ctx.openCheckout) {
    return <NoCheckoutGate />
  }

  return (
    <StepCheckout
      persons={ctx.persons}
      usageType={ctx.usageType}
      setUsageType={ctx.setUsageType}
      tip={ctx.tip}
      setTip={ctx.setTip}
      items={ctx.items}
      config={ctx.pricingConfig}
      submitting={ctx.submitting}
      submitError={ctx.submitError}
      onBack={() =>
        navigate({ to: "/visit", search: ctx.kiosk ? { kiosk: "" } : {} })
      }
      onSubmit={async () => {
        const data = await ctx.submitCheckout()
        if (data) {
          navigate({
            to: "/payment",
            search: ctx.kiosk ? { kiosk: "" } : {},
          })
        }
      }}
    />
  )
}
