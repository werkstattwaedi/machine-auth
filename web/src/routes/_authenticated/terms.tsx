// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { useFirestoreMutation } from "@/hooks/use-firestore-mutation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle } from "lucide-react"
import { serverTimestamp } from "firebase/firestore"

export const Route = createFileRoute("/_authenticated/terms")({
  component: TermsPage,
})

function TermsPage() {
  const { userDoc } = useAuth()
  const { update, loading: saving } = useFirestoreMutation()
  const navigate = useNavigate()

  const handleAccept = async () => {
    if (!userDoc) return
    await update("users", userDoc.id, {
      termsAcceptedAt: serverTimestamp(),
    }, {
      successMessage: "Nutzungsbestimmungen akzeptiert",
    })
    navigate({ to: "/" })
  }

  if (userDoc?.termsAcceptedAt) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Nutzungsbestimmungen</h1>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span>Du hast die Nutzungsbestimmungen bereits akzeptiert.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Nutzungsbestimmungen</h1>

      <Card>
        <CardHeader>
          <CardTitle>Bitte akzeptiere unsere Nutzungsbestimmungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="prose prose-sm max-h-96 overflow-y-auto rounded border p-4 text-sm">
            <h3>Nutzungsbestimmungen der Offenen Werkstatt Wädenswil</h3>
            <p>
              Mit der Nutzung der Werkstatt akzeptierst du folgende Bedingungen:
            </p>
            <ul>
              <li>Die Werkstatt wird auf eigene Verantwortung genutzt.</li>
              <li>Maschinen dürfen nur nach erfolgter Einführung bedient werden.</li>
              <li>Der Arbeitsplatz ist nach Gebrauch sauber zu hinterlassen.</li>
              <li>Material wird nach Verbrauch fair abgerechnet.</li>
              <li>Die Sicherheitsregeln sind jederzeit einzuhalten.</li>
              <li>Der Verein haftet nicht für Unfälle oder Schäden an persönlichen Gegenständen.</li>
            </ul>
            <p>
              Die vollständigen Nutzungsbestimmungen findest du unter{" "}
              <a
                href="https://werkstattwaedi.ch/nutzungsbestimmungen"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                werkstattwaedi.ch/nutzungsbestimmungen
              </a>.
            </p>
          </div>

          <Button onClick={handleAccept} disabled={saving} className="w-full">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Nutzungsbestimmungen akzeptieren
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
