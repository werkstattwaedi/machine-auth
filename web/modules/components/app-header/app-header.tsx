// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The one header bar of both web apps (issue #729, design "C2"): logo left,
// the menu trigger right. The admin app and the checkout member area span it
// across the full width above their sidebar; the checkout wizard centres it
// on its 1000px column. No environment label and no version — the version
// lives on the admin /versions page.

import type { ReactNode } from "react"
import { cn } from "@modules/lib/utils"

export interface AppHeaderProps {
  /** "full" above a sidebar shell, "centered" on the wizard's column. */
  width?: "full" | "centered"
  /** Right-side slot — an `AppMenu` (or nothing). */
  menu?: ReactNode
}

export function AppHeader({ width = "full", menu }: AppHeaderProps) {
  return (
    <header className="w-full shrink-0 border-b border-border bg-background">
      <div
        className={cn(
          "flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6",
          width === "centered" && "mx-auto max-w-[1000px]",
        )}
      >
        <img
          src="/logo_oww.png"
          alt="Offene Werkstatt Wädenswil"
          className="h-[30px] shrink-0 sm:h-11"
        />
        {menu}
      </div>
    </header>
  )
}
