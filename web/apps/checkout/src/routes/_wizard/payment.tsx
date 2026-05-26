// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { PaymentResult } from "@/components/checkout/payment-result"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { CompletionDialog } from "@/components/checkout/completion-dialog"
import { EmptyState } from "@modules/components/empty-state"
import { ShoppingCart } from "lucide-react"

export const Route = createFileRoute("/_wizard/payment")({
  component: PaymentRoute,
})

function PaymentRoute() {
  const ctx = useWizardContext()
  const navigate = useNavigate()
  const [completed, setCompleted] = useState(false)

  // C4 guard: empty-state if landed on /payment with no closed checkout
  // payload. The route is only meaningful immediately after a successful
  // submit on /checkout. Loop-safe — no auto-redirect.
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
    <>
      <PaymentResult
        checkoutId={ctx.paymentData.checkoutId}
        totalPrice={ctx.totalPrice}
        initialPaymentData={ctx.paymentData}
        isMember={!!ctx.identifiedUserDoc?.activeMembership}
        onReset={() => setCompleted(true)}
      />
      <CompletionDialog
        open={completed}
        isLoggedIn={ctx.isAccountLoggedIn}
        // Kiosk + anonymous flows auto-close after 30 s. Logged-in users
        // need no timeout — they're at their own laptop and can take
        // their time before deciding where to go next.
        autoClose={!ctx.isAccountLoggedIn}
        onNewVisit={async () => {
          await ctx.resetWizard()
        }}
        onGoToHistory={
          ctx.isAccountLoggedIn
            ? () => navigate({ to: "/account/usage" })
            : undefined
        }
      />
    </>
  )
}
