// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { enabledPaymentMethods, type PaymentMethod } from "@oww/shared"
import { useBridge } from "@modules/lib/use-bridge"
import { StepCheckout } from "@/components/checkout/step-checkout"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { PaymentFrame } from "@/components/checkout/payment-options"
import { PaymentConfirmation } from "@/components/checkout/payment-confirmation"
import { CheckoutFinishBar } from "@/components/checkout/checkout-finish-bar"
import { useIsPhone } from "@/components/checkout/use-is-phone"
import {
  firstOfNextMonth,
  type PaymentChoice,
  type PaymentData,
} from "@/components/checkout/payment-methods"
import { paymentMethodConfig } from "@/lib/payment-config"
import "@/components/checkout/checkout-history-state"

export const Route = createFileRoute("/_wizard/checkout")({
  component: CheckoutRoute,
})

// Steps 3 and 4 (issue #750) on one page: the summary with the payment
// cards, the chosen card in place, and — once the commit closed the
// checkout — its confirmation. The wizard layout gates this route when no
// open checkout exists, except right after this session committed one.
function CheckoutRoute() {
  const ctx = useWizardContext()
  if (ctx.paymentData && ctx.paymentChoice) {
    return <CheckoutDone paymentData={ctx.paymentData} choice={ctx.paymentChoice} />
  }
  return <CheckoutOpen />
}

function CheckoutOpen() {
  const navigate = useNavigate()
  const ctx = useWizardContext()
  const bridge = useBridge()
  // Set by /visit's "Zum Checkout" (see checkout-history-state.ts). Any
  // other arrival — a stale checkout resumed from the start page, a
  // membership purchase landing here — is about settling what is already
  // in the checkout, so the Vereinsmitgliedschaft section (with its address
  // form) opens instead when the checkout carries one; the id is harmless
  // when no membership is present.
  const expandUsageFees = useLocation({
    select: (l) => l.state.expandUsageFees === true,
  })

  // The QR bill is the fallback of last resort: it needs nothing beyond the
  // bill itself, so even an empty configured list leaves a way to pay.
  const configured = enabledPaymentMethods(
    paymentMethodConfig,
    ctx.kiosk ? "kiosk" : "web",
    { isMember: ctx.isMember },
  )
  const methods: PaymentMethod[] = configured.length > 0 ? configured : ["rechnung"]

  const commit = async (choice: PaymentChoice) => {
    if (choice !== "raisenow") {
      await ctx.submitCheckout(choice === "free" ? undefined : choice)
      return
    }
    // The paylink needs the bill, so it is known only after the close. A
    // phone's popup blocker swallows a window opened after an await, so
    // open it now, inside the click, and point it at the paylink once the
    // close answers. The kiosk opens the paylink in its overlay (KIO-19),
    // which the bridge does for any window.open, gesture or not.
    const popup = bridge.available ? null : window.open("", "_blank")
    popup?.document.write("<p style='font-family:sans-serif'>TWINT wird geöffnet …</p>")
    popup?.document.close()
    const data = await ctx.submitCheckout("raisenow")
    if (!data?.paylinkUrl) {
      // A failed close keeps step 4 for a retry; a missing paylink leaves
      // the confirmation without one. Either way the blank window goes.
      popup?.close()
      return
    }
    if (popup) {
      popup.opener = null
      popup.location.href = data.paylinkUrl
    } else {
      window.open(data.paylinkUrl, "_blank", "noopener,noreferrer")
    }
  }

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
      paymentMethods={methods}
      paymentChoice={ctx.paymentChoice}
      onPaymentChoiceChange={ctx.setPaymentChoice}
      onCommit={commit}
      onBack={() =>
        navigate({ to: "/visit", search: ctx.kiosk ? { kiosk: "" } : {} })
      }
    />
  )
}

function CheckoutDone({
  paymentData,
  choice,
}: {
  paymentData: PaymentData
  choice: PaymentChoice
}) {
  const ctx = useWizardContext()
  const navigate = useNavigate()
  const bridge = useBridge()
  const isPhone = useIsPhone()
  const [qrOpen, setQrOpen] = useState(false)
  // Unfolding the QR slip stops the kiosk countdown for good: someone is
  // scanning it, and folding it again must not restart the clock.
  const [qrHeld, setQrHeld] = useState(false)
  // The server names the method the bill is committed with — the first
  // one, should a retry have asked for another (#750). Its amount decides
  // a free visit: should its recompute land on CHF 0 where the page showed
  // more, the bill closed free, without a mail (BIL-8).
  const amount = Number(paymentData.amount)
  const committed: PaymentChoice =
    choice === "free" || amount === 0 ? "free" : (paymentData.paymentMethod ?? choice)

  // At the kiosk the TWINT payment runs in the overlay (KIO-19), after the
  // commit. Counting down to a reset meanwhile would wipe the session under
  // the person paying, so the countdown waits for the overlay to report the
  // payment done; until then "Fertig" waits for a tap, and the idle watcher
  // still frees an abandoned kiosk.
  const awaitsOverlay = ctx.kiosk && committed === "raisenow"
  const [overlayDone, setOverlayDone] = useState(false)
  useEffect(() => {
    if (!awaitsOverlay) return
    return bridge.onPaymentConfirmed(() => setOverlayDone(true))
  }, [awaitsOverlay, bridge])

  const finish = async () => {
    if (ctx.kiosk) {
      // Hands the terminal to the next person: the strong wipe, same as
      // the kiosk chrome's "Neuer Checkout".
      await ctx.startOver()
    } else {
      navigate({ to: "/account/usage" })
    }
  }

  return (
    <div className="flex flex-col flex-1 gap-6">
      <PaymentFrame amount={amount} free={amount === 0}>
        <PaymentConfirmation
          choice={committed}
          paymentData={paymentData}
          copy={{ email: paymentData.payerEmail, monthlyDate: firstOfNextMonth() }}
          ownDevice={!ctx.kiosk}
          isPhone={isPhone}
          qrOpen={qrOpen}
          onQrOpenChange={(open) => {
            setQrOpen(open)
            if (open) setQrHeld(true)
          }}
        />
      </PaymentFrame>
      <div className="flex-1" />
      <CheckoutFinishBar
        kiosk={ctx.kiosk}
        signedIn={ctx.isAccountLoggedIn}
        holdCountdown={qrHeld || (awaitsOverlay && !overlayDone)}
        onFinish={() => void finish()}
      />
    </div>
  )
}
