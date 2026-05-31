// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useNavigate } from "@tanstack/react-router"
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

interface NoCheckoutGateProps {
  /** Override the description shown in the dialog. */
  description?: string
}

/**
 * Mounted by the wizard layout when the visitor lands directly on
 * `/visit`, `/checkout` or `/payment` without an open checkout. The
 * layout suppresses the wizard chrome (progress indicator, "Schritt N"
 * header) for these gated routes so the dialog reads cleanly against
 * a blank page. The dialog has a single action — navigation to
 * `/checkin` — and is escape-key-locked so the user always has a clear
 * forward path.
 */
export function NoCheckoutGate({
  description = "Du hast aktuell keinen offenen Besuch. Bitte zuerst einchecken, um diese Seite zu nutzen.",
}: NoCheckoutGateProps) {
  const navigate = useNavigate()
  const { kiosk } = useWizardContext()

  return (
    <AlertDialog open>
      <AlertDialogContent
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Kein offener Besuch</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() =>
              navigate({
                to: "/checkin",
                search: kiosk ? { kiosk: "" } : {},
              })
            }
          >
            Zum Check-In
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
