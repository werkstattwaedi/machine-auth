// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { useTokenAuth } from "@/lib/token-auth"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, CheckCircle, XCircle } from "lucide-react"

const checkoutSearch = z.object({
  picc: z.string().optional(),
  cmac: z.string().optional(),
})

export const Route = createFileRoute("/_public/checkout")({
  validateSearch: checkoutSearch,
  component: CheckoutPage,
})

function CheckoutPage() {
  const { picc, cmac } = Route.useSearch()
  const { tokenUser, loading, error } = useTokenAuth(
    picc ?? null,
    cmac ?? null
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkout</CardTitle>
      </CardHeader>
      <CardContent>
        {!picc || !cmac ? (
          <p className="text-muted-foreground">
            Kein Tag erkannt. Bitte halte deinen Tag an das Lesegerät.
          </p>
        ) : loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Tag wird verifiziert...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive">
            <XCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : tokenUser ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="h-4 w-4" />
            <span>
              Tag verifiziert. Benutzer: {tokenUser.userId}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
