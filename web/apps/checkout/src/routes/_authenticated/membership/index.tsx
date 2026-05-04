// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Member self-service: see your membership status, buy a new membership,
 * renew, jump to family roster (when family owner).
 *
 * Purchase / renewal flow:
 *   1. Click "Single kaufen" / "Familie kaufen" / "Verlängern"
 *   2. Callable `purchaseMembership` opens a checkout with the fee SKU
 *   3. We redirect to /visit?openCheckout={id} where the existing
 *      pay flow handles Twint/cash/etc. exactly like a regular visit.
 *      The post-checkout trigger creates/extends the membership.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useDocument } from "@modules/lib/firestore"
import { membershipRef } from "@modules/lib/firestore-helpers"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { useAuth } from "@modules/lib/auth"
import { PageLoading } from "@modules/components/page-loading"
import { Card, CardContent } from "@modules/components/ui/card"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { formatDate } from "@modules/lib/format"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { httpsCallable } from "firebase/functions"

export const Route = createFileRoute("/_authenticated/membership/")({
  component: MembershipPage,
})

function MembershipPage() {
  const db = useDb()
  const functions = useFunctions()
  const { userDoc } = useAuth()
  const navigate = useNavigate()

  // Live-watch the membership doc so renewal/expiry updates show immediately.
  const { data: membership, loading } = useDocument(
    userDoc?.activeMembership ? membershipRef(db, userDoc.activeMembership) : null,
  )

  const purchase = useAsyncMutation({
    context: "checkout.purchaseMembership",
    errorMessage: "Mitgliedschaft konnte nicht gestartet werden",
  })

  const startPurchase = async (
    type: "single" | "family",
    renewExisting: boolean,
  ) => {
    await purchase.mutate(async () => {
      const fn = httpsCallable<
        { type: "single" | "family"; renewExisting?: boolean },
        { checkoutId: string }
      >(functions, "purchaseMembership")
      const res = await fn({ type, renewExisting })
      const checkoutId = res.data.checkoutId
      // The fee sits inside the existing checkout flow — jump to /visit
      // so the user can pay with Twint/cash like any other checkout.
      // Using `as never` because TanStack Router's useNavigate types are
      // narrowed against the calling app's route tree at type-check time.
      navigate({ to: "/visit", search: { openCheckout: checkoutId } as never } as never)
    })
  }

  if (loading) return <PageLoading />

  const isOwner = membership?.ownerUserId.id === userDoc?.id
  const isExpired = membership?.status === "expired"
  const isCancelled = membership?.status === "cancelled"
  const validUntil = membership?.validUntil ?? null

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">Mitgliedschaft</h1>

      {membership ? (
        <Card className="mb-4">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Badge variant={membership.type === "family" ? "default" : "secondary"}>
                {membership.type === "family" ? "Familie" : "Einzel"}
              </Badge>
              <Badge
                variant={
                  membership.status === "active"
                    ? "default"
                    : membership.status === "expired"
                      ? "destructive"
                      : "outline"
                }
              >
                {membership.status === "active"
                  ? "Aktiv"
                  : membership.status === "expired"
                    ? "Abgelaufen"
                    : "Gekündigt"}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              Gültig bis: <span className="font-medium">{formatDate(validUntil)}</span>
            </div>

            {!isCancelled && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={() =>
                    startPurchase(membership.type, !isExpired)
                  }
                  disabled={purchase.loading}
                >
                  {isExpired ? "Erneuern" : "Verlängern"}
                </Button>
                {isOwner && membership.type === "family" && (
                  <Link
                    to={"/membership/family" as never}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input px-4 h-9 hover:bg-accent"
                  >
                    Familie verwalten
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm">
              Du bist aktuell kein Vereinsmitglied. Mit einer Mitgliedschaft
              erhältst du vergünstigte Preise auf Maschinen und Material.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => startPurchase("single", false)}
                disabled={purchase.loading}
              >
                Einzelmitgliedschaft kaufen
              </Button>
              <Button
                variant="secondary"
                onClick={() => startPurchase("family", false)}
                disabled={purchase.loading}
              >
                Familienmitgliedschaft kaufen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
