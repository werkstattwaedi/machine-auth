// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

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
import { CheckCircle2, History } from "lucide-react"

const AUTO_RESET_MS = 30_000
/** How often the progress fill repaints (ms). Fine enough for a smooth
 * bar, independent of the auto-reset deadline. */
const PROGRESS_TICK_MS = 100

interface CompletionDialogProps {
  open: boolean
  /** When true, render the "Vergangene Besuche" secondary button.
   * Anonymous / kiosk / tag-auth users only see the primary button. */
  isLoggedIn: boolean
  /**
   * Kiosk + anonymous flows: the dialog auto-closes after 30 s and
   * resets the terminal for the next person. Logged-in users have no
   * timeout. */
  autoClose: boolean
  /** Primary CTA. On the kiosk/anonymous path this just closes the
   * terminal ("Fertig"); for logged-in users it starts a fresh visit.
   * Resets the wizard + (if kiosk) wipes the bridge session. */
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
  // Fraction of the auto-reset window already elapsed (0 → 1). Drives the
  // progress fill behind the primary button, mirroring the MaCo terminal's
  // "Beenden?" confirmation where the button fills up as the timer runs.
  const [progress, setProgress] = useState(0)

  // Keep the latest onNewVisit without re-arming the timer each render.
  const onNewVisitRef = useRef(onNewVisit)
  onNewVisitRef.current = onNewVisit

  useEffect(() => {
    if (!open || !autoClose) return
    setProgress(0)
    const start = Date.now()
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - start
      if (elapsed >= AUTO_RESET_MS) {
        window.clearInterval(interval)
        setProgress(1)
        onNewVisitRef.current()
        return
      }
      setProgress(elapsed / AUTO_RESET_MS)
    }, PROGRESS_TICK_MS)
    return () => window.clearInterval(interval)
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
            {autoClose
              ? "Vielen Dank und bis bald."
              : "Vielen Dank! Du kannst jetzt einen neuen Besuch starten oder zu deinen vergangenen Besuchen wechseln."}
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
          {autoClose ? (
            // Kiosk/anonymous: a single "Fertig" button whose background
            // fills as the auto-reset timer elapses (MaCo "Beenden?" style),
            // so there is no separate countdown text to confuse the user.
            <AlertDialogAction
              onClick={onNewVisit}
              className="relative overflow-hidden"
            >
              <span
                aria-hidden
                data-testid="completion-autoreset-progress"
                className="absolute inset-y-0 left-0 bg-cog-teal-dark transition-[width] duration-100 ease-linear"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
              <span className="relative z-10">Fertig</span>
            </AlertDialogAction>
          ) : (
            <AlertDialogAction onClick={onNewVisit}>
              Neuer Besuch starten
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
