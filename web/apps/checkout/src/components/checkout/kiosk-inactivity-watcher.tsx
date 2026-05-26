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
import { Clock } from "lucide-react"
import { useWizardContext } from "./wizard-context"

const IDLE_MS = 5 * 60 * 1000
const POPUP_AUTO_CLOSE_SECONDS = 30
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "pointerdown",
  "keydown",
  "scroll",
]

/**
 * Kiosk-only idle watcher. Renders nothing for browser/anonymous/logged-in
 * users — the screensaver/refresh dance is only meaningful at the
 * Werkstatt's kiosk terminal. After 5 minutes of inactivity we surface a
 * "Bist du noch da?" dialog with a 30-second auto-close countdown; if the
 * countdown runs out the wizard resets to /checkin (bridge session wiped
 * inside `resetWizard`).
 *
 * Phase 5 of the wizard-routes refactor — previously this logic lived in
 * the giant CheckoutWizard component and (incorrectly) also fired for
 * non-kiosk anonymous browser users.
 */
export function KioskInactivityWatcher() {
  const { kiosk, resetWizard } = useWizardContext()
  const [open, setOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(POPUP_AUTO_CLOSE_SECONDS)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Only run for kiosk sessions.
  useEffect(() => {
    if (!kiosk) return

    const resetIdle = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => {
        setOpen(true)
      }, IDLE_MS)
    }

    resetIdle()
    const handler = () => {
      if (!open) resetIdle()
    }
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handler, { passive: true })
    }
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handler)
      }
    }
  }, [kiosk, open])

  // 30-second auto-close once the dialog is open.
  useEffect(() => {
    if (!open) return
    setSecondsLeft(POPUP_AUTO_CLOSE_SECONDS)
    const interval = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(interval)
          // Fire-and-forget; resetWizard handles the navigate + signOut.
          void resetWizard()
          setOpen(false)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!kiosk) return null

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-cog-teal" />
            Bist du noch da?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Es war eine Weile ruhig. Möchtest du deinen Besuch fortsetzen?
            <span className="block mt-2 text-xs">
              Sonst startet automatisch ein neuer Besuch in {secondsLeft}{" "}
              {secondsLeft === 1 ? "Sekunde" : "Sekunden"}…
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setOpen(false)}>
            Besuch fortsetzen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
