// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Tab bar of the Inventar workspace. The four surfaces are separate
// routes (deep-linkable) that share this bar so they read as one
// workspace: Durchsuchen · Import · Preislisten · Etiketten.

import { Link, useLocation } from "@tanstack/react-router"
import { FileText, GitCompare, List, Tag } from "lucide-react"

const TABS = [
  { to: "/materials", label: "Durchsuchen", icon: List, exact: true },
  { to: "/materials/import", label: "Import", icon: GitCompare },
  { to: "/price-lists", label: "Preislisten", icon: FileText },
  { to: "/materials/labels", label: "Etiketten", icon: Tag },
] as const

export function InventoryTabs() {
  const { pathname } = useLocation()
  return (
    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1">
      {TABS.map(({ to, label, icon: Icon, ...opts }) => {
        const active =
          "exact" in opts && opts.exact
            ? pathname === to || pathname === `${to}/`
            : pathname.startsWith(to)
        return (
          <Link
            key={to}
            to={to}
            className={
              "inline-flex h-full items-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        )
      })}
    </div>
  )
}
