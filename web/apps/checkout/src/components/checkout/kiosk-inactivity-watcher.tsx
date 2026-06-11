// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

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
import { useWizardContext } from "./wizard-context"
import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"

const IDLE_MS = 5 * 60 * 1000
const POPUP_AUTO_CLOSE_SECONDS = 30
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "pointerdown",
  "keydown",
  "scroll",
]

/**
 * Whether a single person has typed-in content worth preserving. A pristine
 * pre-filled identity (logged-in / tag-tap seed — `isPreFilled: true` with
 * populated name/email and `termsAccepted: true`) must NOT count as dirty:
 * the user did not type anything, so resetting it loses nothing. Only a
 * person the user actually edited (`!isPreFilled`) with non-empty trimmed
 * name/email, or who accepted terms, is considered dirty.
 */
function isPersonDirty(p: CheckoutPerson): boolean {
  if (p.isPreFilled) return false
  return (
    p.firstName.trim() !== "" ||
    p.lastName.trim() !== "" ||
    p.email.trim() !== "" ||
    p.termsAccepted === true
  )
}

/**
 * Pure, unit-testable predicate: does the current wizard state hold anything
 * worth protecting from an idle reset? True when there's a checkout (open,
 * persisted, or pending), any items in the cart, more than one person, or any
 * person with typed-in content (see {@link isPersonDirty}). A fresh
 * `/checkin?kiosk` with a single empty (or single pristine pre-filled) person
 * and no checkout returns false — the idle watcher should not arm.
 */
export function hasPreservableState({
  openCheckout,
  checkoutId,
  pendingCheckout,
  items,
  persons,
}: {
  openCheckout: CheckoutDoc | null
  checkoutId: string | null
  pendingCheckout: boolean
  items: CheckoutItemLocal[]
  persons: CheckoutPerson[]
}): boolean {
  const hasCheckout =
    openCheckout != null || checkoutId != null || pendingCheckout
  const isDirty =
    items.length > 0 || persons.length > 1 || persons.some(isPersonDirty)
  return hasCheckout || isDirty
}

/**
 * Kiosk-only idle watcher. Renders nothing for browser/anonymous/logged-in
 * users — the screensaver/refresh dance is only meaningful at the
 * Werkstatt's kiosk terminal. After 5 minutes of inactivity we surface a
 * "Bist du noch da?" dialog whose "Neuen Besuch starten" button auto-accepts
 * after 30 s (filling background, no countdown text); when it fires the
 * terminal is handed to the next person via
 * `startOver` — the same strong wipe as the Electron chrome's "Neuer
 * Checkout" (signOut + bridge partition wipe + hard reload). A soft
 * `resetWizard` is not enough here: it keeps the in-memory Firebase
 * session alive, so the previous visitor's open checkout would rehydrate
 * straight back onto the fresh /checkin.
 *
 * Phase 5 of the wizard-routes refactor — previously this logic lived in
 * the giant CheckoutWizard component and (incorrectly) also fired for
 * non-kiosk anonymous browser users.
 */
export function KioskInactivityWatcher() {
  const {
    kiosk,
    startOver,
    openCheckout,
    checkoutId,
    pendingCheckout,
    items,
    persons,
  } = useWizardContext()
  // Only arm the idle watcher when there is session state worth protecting.
  // A fresh /checkin?kiosk with an empty form and no checkout should not pop
  // the "Bist du noch da?" dialog (issue #378).
  const shouldWatch =
    kiosk &&
    hasPreservableState({
      openCheckout,
      checkoutId,
      pendingCheckout,
      items,
      persons,
    })
  const [open, setOpen] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read the dialog's open state from inside the activity handler without
  // putting `open` in the listener effect's deps (which would tear down and
  // re-add the window listeners on every open/close).
  const openRef = useRef(open)
  openRef.current = open

  const armIdle = useCallback(() => {
    if (!shouldWatch) return
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setOpen(true), IDLE_MS)
  }, [shouldWatch])

  // Activity listeners — attached once per kiosk session (no churn on
  // open/close). Each activity re-arms the idle timer only while the dialog
  // is closed.
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
  // (the auto-close effect below owns the timing once the dialog is up).
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

  if (!shouldWatch) return null

  // The auto-accepting "Neuen Besuch starten" button owns the 30 s timing —
  // its filling background replaces the old countdown text (same pattern as
  // the completion dialog). "Besuch fortsetzen" aborts back to the visit.
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
          <AlertDialogAction variant="outline" onClick={() => setOpen(false)}>
            Besuch fortsetzen
          </AlertDialogAction>
          <AutoActionButton
            durationMs={POPUP_AUTO_CLOSE_SECONDS * 1000}
            onAction={() => {
              setOpen(false)
              // Fire-and-forget; startOver handles signOut + bridge wipe +
              // hard reload to a fresh /checkin?kiosk.
              void startOver()
            }}
          >
            Neuen Besuch starten
          </AutoActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
