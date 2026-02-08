// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/_admin/users")({
  component: UsersPage,
})

function UsersPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Benutzer</h1>
      <p className="text-muted-foreground mt-2">Admin-Bereich: Benutzerverwaltung</p>
    </div>
  )
}
