// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createRootRoute, Outlet } from "@tanstack/react-router"
import { FirebaseProvider } from "@modules/lib/firebase-context"
import { AuthProvider } from "@modules/lib/auth"
import { Toaster } from "@modules/components/ui/sonner"
import { MarkerIO } from "@modules/components/marker-io"
import { auth, db, functions } from "@modules/lib/firebase"
import { BridgeNfcRouter } from "@/components/bridge-nfc-router"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <FirebaseProvider value={{ db, auth, functions }}>
      <AuthProvider>
        <BridgeNfcRouter />
        <Outlet />
        <Toaster />
        <MarkerIO />
      </AuthProvider>
    </FirebaseProvider>
  )
}
