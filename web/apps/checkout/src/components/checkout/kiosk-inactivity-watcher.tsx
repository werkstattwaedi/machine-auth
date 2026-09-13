// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useWizardContext } from "./wizard-context"
import { KioskIdleDialog, useIdleDialog } from "./kiosk-idle-dialog"
import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { CheckoutDoc } from "@modules/lib/firestore-entities"

const IDLE_MS = 5 * 60 * 1000

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
  const [open, setOpen] = useIdleDialog(shouldWatch, IDLE_MS)

  if (!shouldWatch) return null

  return (
    <KioskIdleDialog
      open={open}
      onContinue={() => setOpen(false)}
      onReset={() => {
        setOpen(false)
        // Fire-and-forget; startOver handles signOut + bridge wipe +
        // hard reload to a fresh /checkin?kiosk.
        void startOver()
      }}
    />
  )
}
