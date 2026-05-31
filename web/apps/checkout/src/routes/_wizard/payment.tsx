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

// The wizard layout gates this route when no open checkout exists. We
// still defend against the "open checkout but no paymentData" case —
// the user landed here via deep link or browser back without going
// through /checkout's submit — by rendering an empty state.
function PaymentRoute() {
  const ctx = useWizardContext()
  const navigate = useNavigate()
  const [completed, setCompleted] = useState(false)

  if (!ctx.paymentData) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Keine Zahlung offen"
        description="Schliesse zuerst den Checkout ab, um die Zahlung zu starten."
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
