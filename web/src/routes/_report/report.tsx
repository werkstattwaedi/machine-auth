// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle } from "lucide-react"

const reportSearchSchema = z.object({
  machine: z.string().optional(),
  session: z.string().optional(),
})

export const Route = createFileRoute("/_report/report")({
  validateSearch: reportSearchSchema,
  component: ReportPage,
})

function ReportPage() {
  return (
    <Card>
      <CardContent className="pt-6 text-center space-y-3">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
        <h2 className="text-lg font-semibold">Störungsmeldung</h2>
        <p className="text-sm text-muted-foreground">
          Diese Funktion ist noch in Entwicklung. Bitte melde Störungen
          direkt an der Werkstatt-Theke.
        </p>
      </CardContent>
    </Card>
  )
}
