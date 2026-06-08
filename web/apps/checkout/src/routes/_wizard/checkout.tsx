// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { StepCheckout } from "@/components/checkout/step-checkout"
import { useWizardContext } from "@/components/checkout/wizard-context"

export const Route = createFileRoute("/_wizard/checkout")({
  component: CheckoutRoute,
})

// The wizard layout gates this route when no open checkout exists.
function CheckoutRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()

  return (
    <StepCheckout
      persons={ctx.persons}
      usageType={ctx.usageType}
      setUsageType={ctx.setUsageType}
      tip={ctx.tip}
      setTip={ctx.setTip}
      items={ctx.items}
      config={ctx.pricingConfig}
      membershipCatalogId={ctx.membershipCatalogId}
      onPrimaryBillingChange={(updates) => {
        const primary = ctx.persons[0]
        if (primary) {
          ctx.personsDispatch({ type: "UPDATE_PERSON", id: primary.id, updates })
        }
      }}
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
