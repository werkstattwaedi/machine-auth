// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@modules/components/ui/button"
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
import { cn } from "@modules/lib/utils"
import { useWizardContext } from "./wizard-context"

/**
 * "Von vorne beginnen" — the anonymous visitor's escape hatch out of an open
 * checkout, mirroring the signed-in "Abmelden". Self-contained and
 * self-gating: it reads the wizard context and renders nothing unless the
 * session is anonymous AND there's an open checkout to abandon, so it can be
 * dropped anywhere inside the WizardProvider (the shared chrome today; a
 * reload-time prompt later) without the caller re-deriving that condition.
 *
 * Confirms first — the open checkout, including any /visit cart items, is
 * abandoned — then calls `startOver` (drop the anon session + hard-reload to a
 * fresh /checkin; the old checkout is orphaned for the #318 cleanup job).
 *
 * Kiosk mode (issue #415): the chrome's "Neuer Checkout" button is the
 * affordance, so the in-page trigger button is hidden when the bridge is
 * available. The component still subscribes to the chrome's start-over request
 * and opens *this* confirm dialog (single confirm UI, no duplicate chrome
 * overlay), acking so the chrome cancels its hardware-escape-hatch fallback.
 */
export function StartOverButton({ className }: { className?: string }) {
  const { isAnonymous, openCheckout, startOver } = useWizardContext()
  const { available, ackStartOver, onStartOverRequest } = useBridge()
  const [confirming, setConfirming] = useState(false)

  // Open this confirm when the kiosk chrome's "Neuer Checkout" button asks for
  // it, and ack so the chrome cancels its timeout fallback. No-op in a browser
  // tab (onStartOverRequest is a no-op there). Only intercept when there's
  // something to discard — otherwise leave the chrome's direct reset (its
  // fallback) to handle the empty case, since there's no checkout to confirm.
  const hasCheckoutToDiscard = isAnonymous && !!openCheckout
  useEffect(() => {
    if (!hasCheckoutToDiscard) return
    return onStartOverRequest(() => {
      ackStartOver()
      setConfirming(true)
    })
  }, [hasCheckoutToDiscard, onStartOverRequest, ackStartOver])

  if (!isAnonymous || !openCheckout) return null

  return (
    <>
      {/* In the kiosk the chrome button drives the flow, so the in-page
          trigger is hidden — but the dialog below still renders so the
          chrome's request can open it. */}
      {!available && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-muted-foreground hover:text-foreground",
            className,
          )}
          onClick={() => setConfirming(true)}
        >
          <RotateCcw className="h-4 w-4" />
          Von vorne beginnen
        </Button>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
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
    </>
  )
}
