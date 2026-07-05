// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Badge } from "@modules/components/ui/badge"
import type { MachineStatus } from "@/lib/machine-status"

export function MachineStatusDot({ status }: { status: MachineStatus }) {
  const color =
    status === "free"
      ? "bg-cog-teal-dark"
      : status === "blocked"
        ? "bg-destructive"
        : "bg-oww-gold-dark"
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`}
      aria-hidden
    />
  )
}

export function MachineStatusBadge({ status }: { status: MachineStatus }) {
  switch (status) {
    case "free":
      return <Badge variant="secondary">frei</Badge>
    case "blocked":
      return <Badge variant="destructive">gesperrt</Badge>
    case "maintenance":
      return (
        <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
          Wartung
        </Badge>
      )
  }
}
