// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
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
import { Button } from "@modules/components/ui/button"
import { EmptyState } from "@modules/components/empty-state"
import { Coffee, LogIn } from "lucide-react"
import { useWizardContext } from "./wizard-context"

interface NoCheckoutGateProps {
  /** Override the description shown both in the dialog and the
   * fallback empty state. Defaults to a generic check-in prompt. */
  description?: string
}

/**
 * Render when a wizard route (`/visit`, `/checkout`, `/payment`) is hit
 * without an open checkout doc. Opens an AlertDialog offering
 * navigation to `/checkin`; dismissing leaves an empty-state with the
 * same CTA so the user can act later. No auto-redirect — explicit
 * choice keeps the URL navigable.
 */
export function NoCheckoutGate({
  description = "Du hast aktuell keinen offenen Besuch. Bitte zuerst einchecken, um diese Seite zu nutzen.",
}: NoCheckoutGateProps) {
  const navigate = useNavigate()
  const { kiosk } = useWizardContext()
  const [open, setOpen] = useState(true)

  const goCheckin = () => {
    setOpen(false)
    navigate({ to: "/checkin", search: kiosk ? { kiosk: "" } : {} })
  }

  return (
    <>
      <EmptyState
        icon={Coffee}
        title="Kein offener Besuch"
        description={description}
        action={
          <Button onClick={goCheckin} className="bg-cog-teal hover:bg-cog-teal-dark">
            <LogIn className="h-4 w-4 mr-2" />
            Zum Check-In
          </Button>
        }
      />

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kein offener Besuch</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={goCheckin}>
              Zum Check-In
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
