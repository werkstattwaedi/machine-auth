// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The kiosk "Bist du noch da?" idle primitive, shared by the wizard's
 * KioskInactivityWatcher and the member-area KioskAccountIdleWatcher
 * (ADR-0041). `useIdleDialog` arms an idle countdown from pointer/key/scroll
 * activity while `shouldWatch`; the dialog's auto-accepting button then
 * owns the 30 s grace before `onReset` fires.
 */

import { useCallback, useEffect, useRef, useState } from "react"
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
import { AutoActionButton } from "./auto-action-button"

export const IDLE_POPUP_AUTO_CLOSE_SECONDS = 30
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "pointerdown",
  "keydown",
  "scroll",
]

export function useIdleDialog(
  shouldWatch: boolean,
  idleMs: number,
): [open: boolean, setOpen: (next: boolean) => void] {
  const [open, setOpen] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read the dialog's open state from inside the activity handler without
  // putting `open` in the listener effect's deps (which would tear down and
  // re-add the window listeners on every open/close).
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const armIdle = useCallback(() => {
    if (!shouldWatch) return
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setOpen(true), idleMs)
  }, [shouldWatch, idleMs])

  // Activity listeners — attached once per watch (no churn on open/close).
  // Each activity re-arms the idle timer only while the dialog is closed.
  useEffect(() => {
    if (!shouldWatch) return
    const handler = () => {
      if (!openRef.current) armIdle()
    }
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handler, { passive: true })
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handler)
      }
    }
  }, [shouldWatch, armIdle])

  // Arm the idle countdown while the dialog is closed; clear it while open
  // (the auto-close owns the timing once the dialog is up).
  useEffect(() => {
    if (!shouldWatch) return
    if (open) {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      return
    }
    armIdle()
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [shouldWatch, open, armIdle])

  // A watch that stops (route change, elevation expiry) must not leave a
  // stale dialog behind — report closed without a state write.
  return [open && shouldWatch, setOpen]
}

export function KioskIdleDialog({
  open,
  onContinue,
  onReset,
}: {
  open: boolean
  onContinue: () => void
  onReset: () => void
}) {
  // The auto-accepting "Neuen Besuch starten" button owns the 30 s timing —
  // its filling background replaces a countdown text (same pattern as the
  // completion dialog). "Besuch fortsetzen" aborts back to the visit.
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
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction variant="outline" onClick={onContinue}>
            Besuch fortsetzen
          </AlertDialogAction>
          <AutoActionButton
            durationMs={IDLE_POPUP_AUTO_CLOSE_SECONDS * 1000}
            onAction={onReset}
          >
            Neuen Besuch starten
          </AutoActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
