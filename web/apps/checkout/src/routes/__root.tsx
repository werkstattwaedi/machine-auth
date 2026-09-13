// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createRootRoute, Outlet } from "@tanstack/react-router"
import { FirebaseProvider } from "@modules/lib/firebase-context"
import { AuthProvider } from "@modules/lib/auth"
import { Toaster } from "@modules/components/ui/sonner"
import { MarkerIO } from "@modules/components/marker-io"
import { auth, db, functions } from "@modules/lib/firebase"
import { BridgeNfcRouter } from "@/components/bridge-nfc-router"
import { KioskElevationProvider } from "@/components/checkout/kiosk-elevation-dialog"
import { KioskAccountIdleWatcher } from "@/components/account/kiosk-account-idle-watcher"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <FirebaseProvider value={{ db, auth, functions }}>
      <AuthProvider>
        {/* Kiosk step-up dialog + member-area idle watcher (ADR-0041) sit
            above the route tree: the wizard opens the dialog, the account
            routes are watched. Both are inert outside a kiosk session. */}
        <KioskElevationProvider>
          <BridgeNfcRouter />
          <KioskAccountIdleWatcher />
          <Outlet />
          <Toaster />
          <MarkerIO />
        </KioskElevationProvider>
      </AuthProvider>
    </FirebaseProvider>
  )
}
