// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { useBridge } from "@modules/lib/use-bridge"
import { useWizardContext } from "./wizard-context"

/**
 * "Von vorne beginnen" — the anonymous visitor's escape hatch out of an open
 * checkout, mirroring the signed-in "Abmelden". Split in two (#729): the
 * trigger is an entry of the anonymous header menu
 * (`useStartOverMenuEntry`), while the confirm dialog
 * stays mounted in the wizard chrome — it must outlive the menu closing, and
 * it also answers the kiosk chrome's request.
 *
 * Confirms first — the open checkout, including any /visit cart items, is
 * abandoned — then calls `startOver` (drop the anon session + hard-reload to a
 * fresh /checkin; the old checkout is orphaned for the #318 cleanup job).
 */

/**
 * The confirm dialog. Also subscribes to the kiosk chrome's start-over
 * request and opens *this* dialog (single confirm UI, no duplicate chrome
 * overlay), acking so the chrome cancels its hardware-escape-hatch fallback.
 */
export function StartOverConfirm({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { isAnonymous, openCheckout, startOver } = useWizardContext()
  const { ackStartOver, onStartOverRequest } = useBridge()

  // No-op in a browser tab (onStartOverRequest is a no-op there). Only
  // intercept when there's something to discard — otherwise leave the
  // chrome's direct reset (its fallback) to handle the empty case, since
  // there's no checkout to confirm.
  const hasCheckoutToDiscard = isAnonymous && !!openCheckout
  useEffect(() => {
    if (!hasCheckoutToDiscard) return
    return onStartOverRequest(() => {
      ackStartOver()
      onOpenChange(true)
    })
  }, [hasCheckoutToDiscard, onStartOverRequest, ackStartOver, onOpenChange])

  if (!hasCheckoutToDiscard) return null

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Besuch verwerfen?</AlertDialogTitle>
          <AlertDialogDescription>
            Deine Angaben und der bisherige Warenkorb gehen verloren. Möchtest
            du wirklich von vorne beginnen?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              void startOver()
            }}
          >
            Verwerfen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
