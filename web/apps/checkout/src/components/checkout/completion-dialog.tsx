// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

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
import { AutoActionButton } from "./auto-action-button"

// 8s (was 30s): the person already paid and is leaving — the terminal
// should free itself quickly for the next visitor.
const AUTO_RESET_MS = 8_000

interface CompletionDialogProps {
  open: boolean
  /** When true, render the "Vergangene Besuche" secondary button.
   * Anonymous / kiosk / tag-auth users only see the primary button. */
  isLoggedIn: boolean
  /**
   * Kiosk + anonymous flows: the dialog auto-closes after 8 s and
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
            <AutoActionButton durationMs={AUTO_RESET_MS} onAction={onNewVisit}>
              Fertig
            </AutoActionButton>
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
