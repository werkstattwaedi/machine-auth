// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react"
import { type LucideIcon } from "lucide-react"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && <Icon className="h-10 w-10 text-muted-foreground mb-3" />}
      <h3 className="text-sm font-medium">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
