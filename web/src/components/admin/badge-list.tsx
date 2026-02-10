// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Badge } from "@/components/ui/badge"

interface BadgeListProps {
  items: string[]
  variant?: "default" | "secondary" | "outline" | "destructive"
}

export function BadgeList({ items, variant = "secondary" }: BadgeListProps) {
  if (items.length === 0) return <span className="text-muted-foreground">–</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant={variant}>
          {item}
        </Badge>
      ))}
    </div>
  )
}
