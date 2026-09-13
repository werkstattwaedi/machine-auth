// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Member-area idle watcher for the kiosk (ADR-0041). The wizard's
 * KioskInactivityWatcher lives inside the wizard and only arms with
 * preservable checkout state; an OTP-elevated session browsing
 * `/account/*` has profile data, bills and membership actions exposed, so
 * it gets its own, shorter idle window: 2 min → "Bist du noch da?" → 30 s →
 * the same strong wipe as the chrome's "Neuer Checkout" (signOut + bridge
 * partition wipe + hard reload to a fresh /checkin?kiosk).
 *
 * Mounted at the root; renders nothing outside the Electron bridge, for
 * un-elevated sessions, and off the account routes.
 */

import { useLocation } from "@tanstack/react-router"
import { useAuth } from "@modules/lib/auth"
import { useBridge } from "@modules/lib/use-bridge"
import { runStartOver } from "@/components/checkout/start-over"
import { KioskIdleDialog, useIdleDialog } from "@/components/checkout/kiosk-idle-dialog"

export const ACCOUNT_IDLE_MS = 2 * 60 * 1000

export function KioskAccountIdleWatcher() {
  const bridge = useBridge()
  const { isKioskElevated, signOut } = useAuth()
  const { pathname } = useLocation()
  const shouldWatch =
    bridge.available && isKioskElevated && pathname.startsWith("/account")
  const [open, setOpen] = useIdleDialog(shouldWatch, ACCOUNT_IDLE_MS)

  if (!shouldWatch) return null

  return (
    <KioskIdleDialog
      open={open}
      onContinue={() => setOpen(false)}
      onReset={() => {
        setOpen(false)
        void runStartOver({
          signOut,
          bridgeAvailable: bridge.available,
          resetSession: bridge.resetSession,
          reload: (target) => window.location.replace(target),
          kiosk: true,
        })
      }}
    />
  )
}
