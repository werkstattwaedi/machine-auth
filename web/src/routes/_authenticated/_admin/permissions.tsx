// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/_admin/permissions")({
  component: PermissionsPage,
})

function PermissionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Berechtigungen</h1>
      <p className="text-muted-foreground mt-2">Admin-Bereich: Berechtigungsverwaltung</p>
    </div>
  )
}
