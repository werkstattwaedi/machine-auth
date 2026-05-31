// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { CheckCircle2, History } from "lucide-react"

const AUTO_RESET_SECONDS = 30

interface CompletionDialogProps {
  open: boolean
  /** When true, render the "Vergangene Besuche" secondary button.
   * Anonymous / kiosk / tag-auth users only see the primary button. */
  isLoggedIn: boolean
  /**
   * Kiosk + anonymous flows: the dialog auto-closes after 30 s and
   * triggers a new visit. Logged-in users have no timeout. */
  autoClose: boolean
  /** Primary CTA — start a fresh visit. Resets the wizard + (if kiosk)
   * wipes the bridge session. */
  onNewVisit: () => void
  /** Secondary CTA shown only for logged-in users — navigate to
   * /account/usage where the new bill appears in the history. */
  onGoToHistory?: () => void
}

export function CompletionDialog({
  open,
  isLoggedIn,
  autoClose,
  onNewVisit,
  onGoToHistory,
}: CompletionDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_RESET_SECONDS)

  useEffect(() => {
    if (!open || !autoClose) return
    setSecondsLeft(AUTO_RESET_SECONDS)
    const interval = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(interval)
          onNewVisit()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoClose])

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-cog-teal" />
            Checkout abgeschlossen
          </AlertDialogTitle>
          <AlertDialogDescription>
            Vielen Dank! Du kannst jetzt einen neuen Besuch starten
            {isLoggedIn ? " oder zu deinen vergangenen Besuchen wechseln." : "."}
            {autoClose && (
              <span className="block mt-2 text-xs">
                Neuer Besuch startet automatisch in {secondsLeft}{" "}
                {secondsLeft === 1 ? "Sekunde" : "Sekunden"}…
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-end">
          {isLoggedIn && onGoToHistory && (
            <AlertDialogAction
              variant="outline"
              onClick={onGoToHistory}
              className="inline-flex items-center gap-2"
            >
              <History className="h-4 w-4" />
              Vergangene Besuche
            </AlertDialogAction>
          )}
          <AlertDialogAction onClick={onNewVisit}>
            Neuer Besuch starten
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
