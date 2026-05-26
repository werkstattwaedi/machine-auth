// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { PaymentResult } from "@/components/checkout/payment-result"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { EmptyState } from "@modules/components/empty-state"
import { ShoppingCart } from "lucide-react"

export const Route = createFileRoute("/_wizard/payment")({
  component: PaymentRoute,
})

function PaymentRoute() {
  const ctx = useWizardContext()

  // C4: empty-state if landed on /payment without a closed checkout.
  // (Loop-safe — no auto-redirect; user can navigate back to /checkout
  // explicitly via the route or browser history.)
  if (!ctx.paymentData) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Keine Zahlung offen"
        description="Bezahle zuerst über die Checkout-Seite, um hierher zu gelangen."
      />
    )
  }

  return (
    <PaymentResult
      checkoutId={ctx.paymentData.checkoutId}
      totalPrice={ctx.totalPrice}
      initialPaymentData={ctx.paymentData}
      isMember={!!ctx.identifiedUserDoc?.activeMembership}
      onReset={async () => {
        await ctx.resetWizard()
      }}
    />
  )
}
