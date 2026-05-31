// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
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
 */
export function StartOverButton({ className }: { className?: string }) {
  const { isAnonymous, openCheckout, startOver } = useWizardContext()
  const [confirming, setConfirming] = useState(false)

  if (!isAnonymous || !openCheckout) return null

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn("text-muted-foreground hover:text-foreground", className)}
        onClick={() => setConfirming(true)}
      >
        <RotateCcw className="h-4 w-4" />
        Von vorne beginnen
      </Button>

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
