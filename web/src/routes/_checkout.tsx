// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_checkout")({
  component: CheckoutLayout,
})

function CheckoutLayout() {
  return (
    <div className="min-h-screen flex flex-col items-center bg-background">
      <header className="w-full bg-background px-6 pt-6 pb-2">
        <div className="w-full max-w-[1000px] mx-auto">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-[93px]"
          />
        </div>
      </header>
      <div className="w-full max-w-[1000px] px-6 py-4">
        <h1 className="text-[37px] font-bold mb-6">
          Self-Checkout
        </h1>
        <Outlet />
      </div>
    </div>
  )
}
