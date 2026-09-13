// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { StepCheckout } from "@/components/checkout/step-checkout"
import { useWizardContext } from "@/components/checkout/wizard-context"
import "@/components/checkout/checkout-history-state"

export const Route = createFileRoute("/_wizard/checkout")({
  component: CheckoutRoute,
})

// The wizard layout gates this route when no open checkout exists.
function CheckoutRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()
  // Set by /visit's "Zum Checkout" (see checkout-history-state.ts). Any
  // other arrival — a stale checkout resumed from the start page, a
  // membership purchase landing here — is about settling what is already
  // in the checkout, so the Vereinsmitgliedschaft section (with its address
  // form) opens instead when the checkout carries one; the id is harmless
  // when no membership is present.
  const expandUsageFees = useLocation({
    select: (l) => l.state.expandUsageFees === true,
  })

  return (
    <StepCheckout
      persons={ctx.persons}
      initialOpenSections={expandUsageFees ? ["nutzung"] : ["mitgliedschaft"]}
      anonymous={ctx.isAnonymous}
      usageType={ctx.usageType}
      setUsageType={ctx.setUsageType}
      tip={ctx.tip}
      setTip={ctx.setTip}
      items={ctx.items}
      config={ctx.pricingConfig}
      membershipCatalogId={ctx.membershipCatalogId}
      badgeCatalogId={ctx.badgeCatalogId}
      onPrimaryBillingChange={(updates) => {
        const primary = ctx.persons[0]
        if (primary) {
          ctx.personsDispatch({ type: "UPDATE_PERSON", id: primary.id, updates })
        }
      }}
      profileBillingAddress={ctx.identifiedUserDoc?.billingAddress ?? null}
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
