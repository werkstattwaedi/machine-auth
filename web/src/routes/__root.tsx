// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createRootRoute, Outlet } from "@tanstack/react-router"
import { FirebaseProvider } from "@/lib/firebase-context"
import { AuthProvider } from "@/lib/auth"
import { Toaster } from "@/components/ui/sonner"
import { auth, db, functions } from "@/lib/firebase"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <FirebaseProvider value={{ db, auth, functions }}>
      <AuthProvider>
        <Outlet />
        <Toaster />
      </AuthProvider>
    </FirebaseProvider>
  )
}
