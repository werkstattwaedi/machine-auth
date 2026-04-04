// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createRootRoute, Outlet } from "@tanstack/react-router"
import { FirebaseProvider } from "@modules/lib/firebase-context"
import { AuthProvider } from "@modules/lib/auth"
import { Toaster } from "@modules/components/ui/sonner"
import { MarkerIO } from "@modules/components/marker-io"
import { auth, db, functions } from "@modules/lib/firebase"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <FirebaseProvider value={{ db, auth, functions }}>
      <AuthProvider>
        <Outlet />
        <Toaster />
        <MarkerIO />
      </AuthProvider>
    </FirebaseProvider>
  )
}
