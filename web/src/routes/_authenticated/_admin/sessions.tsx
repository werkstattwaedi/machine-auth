// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/_admin/sessions")({
  component: SessionsPage,
})

function SessionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Sitzungen</h1>
      <p className="text-muted-foreground mt-2">Admin-Bereich: Sitzungsverwaltung</p>
    </div>
  )
}
