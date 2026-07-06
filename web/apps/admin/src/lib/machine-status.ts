// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { MachineDoc } from "@modules/lib/firestore-entities"

/** Derived machine state: frei / gesperrt (Problem) / Wartung. */
export type MachineStatus = "free" | "blocked" | "maintenance"

export function machineStatus(
  machine: Pick<MachineDoc, "blocked">,
): MachineStatus {
  if (!machine.blocked) return "free"
  return machine.blocked.kind === "maintenance" ? "maintenance" : "blocked"
}
