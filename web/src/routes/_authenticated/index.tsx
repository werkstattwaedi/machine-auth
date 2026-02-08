// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
})

function DashboardPage() {
  const { userDoc } = useAuth()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        Hallo{userDoc ? `, ${userDoc.displayName}` : ""}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Willkommen bei der Maschinenfreigabe der Offenen Werkstatt Wädenswil.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
