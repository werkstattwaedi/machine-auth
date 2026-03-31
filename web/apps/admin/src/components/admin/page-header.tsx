// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"

interface PageHeaderProps {
  title: string
  backTo?: string
  backLabel?: string
  action?: ReactNode
}

export function PageHeader({ title, backTo, backLabel, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-3">
        {backTo && (
          <Link
            to={backTo}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">{backLabel ?? "Zurück"}</span>
          </Link>
        )}
        <h1 className="text-2xl font-bold">
          <span className="decoration-cog-teal underline decoration-2 underline-offset-6">
            {title}
          </span>
        </h1>
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
