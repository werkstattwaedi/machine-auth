// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Wizard-level coordinator for the self-service badge purchase offer.
 *
 * Consumes `unregisteredBadge` from the wizard context (set when the
 * verify-once path — /checkin?picc&cmac — hits an authentic badge with no
 * owner) and:
 *  - identified session → opens the purchase dialog immediately;
 *  - anonymous session → parks the voucher in the pending-badge store and
 *    shows a sign-in-first notice; once the visitor identifies (badge tap
 *    or email code — no reload, ADR-0022), the parked offer resumes
 *    without a re-tap.
 *
 * Mid-session taps never reach this component — BridgeNfcRouter probes
 * them at the root layout and shows its own dialog (no navigation).
 */

import { useEffect, useRef, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { useWizardContext } from "./wizard-context"
import {
  BadgePurchaseDialog,
  type BadgePurchaseOffer,
} from "./badge-purchase-dialog"
import { consumePendingBadge, setPendingBadge } from "./pending-badge-store"

export function BadgeOfferCoordinator() {
  const { unregisteredBadge, isAnonymous } = useWizardContext()
  const [offer, setOffer] = useState<BadgePurchaseOffer | null>(null)
  const [signInFirstOpen, setSignInFirstOpen] = useState(false)
  // Each physical tap mints a fresh voucher — key handled-ness on it so a
  // dismissed offer doesn't reopen on unrelated re-renders, but a re-tap
  // makes a new offer.
  const handledVouchers = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!unregisteredBadge) return
    if (handledVouchers.current.has(unregisteredBadge.badgeVoucher)) return
    handledVouchers.current.add(unregisteredBadge.badgeVoucher)
    if (isAnonymous) {
      setPendingBadge(unregisteredBadge)
      setSignInFirstOpen(true)
    } else {
      setOffer(unregisteredBadge)
    }
  }, [unregisteredBadge, isAnonymous])

  // Resume a parked offer once the visitor identifies (kiosk sign-in is
  // SPA-internal, so the store survives; sessionStorage covers reloads
  // within the volatile partition).
  useEffect(() => {
    if (isAnonymous || offer) return
    const pending = consumePendingBadge()
    if (pending) {
      setOffer({
        tokenId: pending.tokenId,
        badgeVoucher: pending.badgeVoucher,
      })
    }
  }, [isAnonymous, offer])

  return (
    <>
      <BadgePurchaseDialog offer={offer} onClose={() => setOffer(null)} />
      <AlertDialog open={signInFirstOpen}>
        <AlertDialogContent data-testid="badge-signin-first-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Neuer Badge erkannt</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Badge gehört noch niemandem. Melde dich zuerst an (mit
              deinem Badge oder per E-Mail-Code) — danach kannst du ihn ohne
              erneutes Auflegen kaufen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSignInFirstOpen(false)}>
              Verstanden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
