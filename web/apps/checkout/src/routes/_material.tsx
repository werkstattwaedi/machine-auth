// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_material")({
  component: MaterialLayout,
})

function MaterialLayout() {
  return (
    <div className="min-h-screen flex flex-col items-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-lg font-semibold">Offene Werkstatt Wädenswil</h1>
          <p className="text-sm text-muted-foreground">Material erfassen</p>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
