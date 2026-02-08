// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
})

function ProfilePage() {
  const { user, userDoc } = useAuth()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Profil</h1>

      <Card>
        <CardHeader>
          <CardTitle>{userDoc?.displayName ?? "Unbekannt"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Name:</span>{" "}
            {userDoc?.name || "–"}
          </div>
          <div>
            <span className="text-muted-foreground">E-Mail:</span>{" "}
            {user?.email || "–"}
          </div>
          <div>
            <span className="text-muted-foreground">Rollen:</span>{" "}
            {userDoc?.roles?.join(", ") || "–"}
          </div>
          <div>
            <span className="text-muted-foreground">Berechtigungen:</span>{" "}
            {userDoc?.permissions?.join(", ") || "–"}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
