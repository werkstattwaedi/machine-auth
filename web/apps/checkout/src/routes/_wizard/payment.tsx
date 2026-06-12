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
      {/* Unmount the payment-method picker once the completion dialog
          opens. The CompletionDialog's overlay only dims the background,
          so a still-mounted PaymentResult leaks through behind it (#449).
          `completed` is terminal: the dialog's primary CTA resets or
          navigates away, so the picker never needs to return. */}
      {!completed && (
        <PaymentResult
          checkoutId={ctx.paymentData.checkoutId}
          totalPrice={ctx.totalPrice}
          initialPaymentData={ctx.paymentData}
          isMember={ctx.isMember}
          kiosk={ctx.kiosk}
          onReset={() => setCompleted(true)}
        />
      )}
      <CompletionDialog
        open={completed}
        isLoggedIn={ctx.isAccountLoggedIn}
        // Kiosk + anonymous flows auto-close after 30 s. Logged-in users
        // need no timeout — they're at their own laptop and can take
        // their time before deciding where to go next.
        autoClose={!ctx.isAccountLoggedIn}
        onNewVisit={async () => {
          // Logged-in users stay signed in: soft reset, roster re-seeds.
          // Kiosk/anonymous "Fertig" hands the terminal to the next person,
          // so it must give the same strong wipe as the Electron chrome's
          // "Neuer Checkout" (signOut + bridge partition wipe + hard
          // reload). The soft resetWizard left the in-memory Firebase
          // session and residual wizard state alive after the partition
          // wipe — leftovers surfaced on the next visit.
          if (ctx.isAccountLoggedIn) {
            await ctx.resetWizard()
          } else {
            await ctx.startOver()
          }
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
