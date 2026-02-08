// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createRootRoute, Outlet } from "@tanstack/react-router"
import { AuthProvider } from "@/lib/auth"
import { Toaster } from "@/components/ui/sonner"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster />
    </AuthProvider>
  )
}
