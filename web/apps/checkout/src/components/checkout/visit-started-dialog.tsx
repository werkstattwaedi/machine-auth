// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { CheckCircle2 } from "lucide-react"
import { AutoActionButton } from "./auto-action-button"

/** How long the confirmation stays up before the terminal resets itself. */
const AUTO_DONE_MS = 8_000

interface VisitStartedDialogProps {
  open: boolean
  /** Resets the terminal for the next person (ctx.startOver). Fired by the
   * auto-timer or the "Fertig" click. */
  onDone: () => void
}

/**
 * Kiosk confirmation after "Besuch starten": the checkout doc exists, the
 * visitor is checked in and walks off into the Werkstatt — the terminal
 * frees itself for the next person via the auto-accepting "Fertig" button.
 */
export function VisitStartedDialog({ open, onDone }: VisitStartedDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-cog-teal" />
            Besuch gestartet
          </AlertDialogTitle>
          <AlertDialogDescription>
            Viel Spass in der Werkstatt! Material, Maschinen und Eintritte
            kannst du jederzeit hier am Kiosk erfassen — Badge einfach wieder
            auflegen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AutoActionButton durationMs={AUTO_DONE_MS} onAction={onDone}>
            Fertig
          </AutoActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
