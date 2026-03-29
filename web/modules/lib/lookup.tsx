// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createContext, useContext, type ReactNode } from "react"
import { useCollection } from "./firestore"

interface LookupMaps {
  permissions: Map<string, string>
  machines: Map<string, string>
  users: Map<string, string>
  terminals: Map<string, string>
}

const LookupContext = createContext<LookupMaps | null>(null)

export function LookupProvider({ children }: { children: ReactNode }) {
  const { data: perms } = useCollection<{ name: string }>("permission")
  const { data: machines } = useCollection<{ name: string }>("machine")
  const { data: users } = useCollection<{ displayName: string }>("users")
  const { data: terminals } = useCollection<{ name: string }>("maco")

  const maps: LookupMaps = {
    permissions: new Map(perms.map((d) => [d.id, d.name])),
    machines: new Map(machines.map((d) => [d.id, d.name])),
    users: new Map(users.map((d) => [d.id, d.displayName || d.id])),
    terminals: new Map(terminals.map((d) => [d.id, d.name || d.id])),
  }

  return (
    <LookupContext.Provider value={maps}>{children}</LookupContext.Provider>
  )
}

export function useLookup(): LookupMaps {
  const ctx = useContext(LookupContext)
  if (!ctx) throw new Error("useLookup must be used within LookupProvider")
  return ctx
}

/** Resolve a DocumentReference / { id } / string to its human label, falling back to the raw ID. */
export function resolveRef(
  map: Map<string, string>,
  ref: { id: string } | string | null | undefined
): string {
  if (!ref) return "–"
  const id = typeof ref === "string" ? ref : ref.id
  return map.get(id) ?? id
}
