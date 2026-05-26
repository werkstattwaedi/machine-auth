// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { PaymentResult } from "@/components/checkout/payment-result"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { CompletionDialog } from "@/components/checkout/completion-dialog"
import { NoCheckoutGate } from "@/components/checkout/no-checkout-gate"

export const Route = createFileRoute("/_wizard/payment")({
  component: PaymentRoute,
})

function PaymentRoute() {
  const ctx = useWizardContext()
  const navigate = useNavigate()
  const [completed, setCompleted] = useState(false)

  // C4 guard: /payment is only meaningful immediately after a successful
  // submit on /checkout (paymentData stamped by the callable). Direct
  // navigation without an open checkout OR without payment data prompts
  // the user to start at /checkin. Loop-safe — no auto-redirect.
  if (!ctx.openCheckout || !ctx.paymentData) {
    return (
      <NoCheckoutGate
        description="Es ist keine Zahlung offen. Starte einen neuen Besuch über den Check-In."
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
