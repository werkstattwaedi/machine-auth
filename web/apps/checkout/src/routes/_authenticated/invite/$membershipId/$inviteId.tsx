// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Family-invite acceptance: an invitee clicks a link to this page (with
 * the membership and invite IDs in the path) and decides to accept or
 * reject.
 *
 * Route shape: /_authenticated/invite/$membershipId/$inviteId
 *
 * Both IDs live in the path so the URL survives a /login redirect when
 * an unauthenticated invitee opens the email link — TanStack Router's
 * pathname is preserved through the auth gate but query strings are not.
 *
 * Auth required: invitee must be signed in (their email determines whether
 * the invite is theirs to accept).
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useDocument } from "@modules/lib/firestore"
import { membershipInviteRef } from "@modules/lib/firestore-helpers"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { useAuth } from "@modules/lib/auth"
import { PageLoading } from "@modules/components/page-loading"
import { Card, CardContent } from "@modules/components/ui/card"
import { Button } from "@modules/components/ui/button"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { httpsCallable } from "firebase/functions"

export const Route = createFileRoute(
  "/_authenticated/invite/$membershipId/$inviteId",
)({
  component: InviteAcceptPage,
})

function InviteAcceptPage() {
  const { membershipId, inviteId } = Route.useParams()
  const db = useDb()
  const functions = useFunctions()
  const { userDoc } = useAuth()
  const navigate = useNavigate()

  const { data: invite, loading } = useDocument(
    membershipInviteRef(db, membershipId, inviteId),
  )

  const acceptMutation = useAsyncMutation({
    context: "checkout.acceptFamilyInvite",
    successMessage: "Eingeladen worden — du gehörst jetzt zur Familie!",
    errorMessage: "Einladung konnte nicht angenommen werden",
  })
  const rejectMutation = useAsyncMutation({
    context: "checkout.rejectFamilyInvite",
    successMessage: "Einladung abgelehnt",
    errorMessage: "Einladung konnte nicht abgelehnt werden",
  })

  if (loading) return <PageLoading />
  if (!invite) {
    return (
      <div className="max-w-md">
        <p>Einladung nicht gefunden oder bereits abgelaufen.</p>
      </div>
    )
  }

  const wrongEmail =
    !!userDoc?.email &&
    invite.email !== userDoc.email.toLowerCase()
  const notPending = invite.status !== "pending"

  const handleAccept = async () => {
    await acceptMutation.mutate(async () => {
      const fn = httpsCallable(functions, "acceptFamilyInvite")
      await fn({ membershipId, inviteId })
      navigate({ to: "/membership" as never } as never)
    })
  }
  const handleReject = async () => {
    await rejectMutation.mutate(async () => {
      const fn = httpsCallable(functions, "rejectFamilyInvite")
      await fn({ membershipId, inviteId })
      navigate({ to: "/membership" as never } as never)
    })
  }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-semibold mb-4">Familieneinladung</h1>
      <Card>
        <CardContent className="pt-6 space-y-3">
          <p>
            Du wurdest zu einer Familienmitgliedschaft eingeladen
            (<span className="font-mono">{invite.email}</span>).
          </p>
          {wrongEmail && (
            <p className="text-sm text-destructive">
              Diese Einladung ist für eine andere E-Mail-Adresse als dein Login.
              Bitte mit der eingeladenen Adresse anmelden.
            </p>
          )}
          {notPending && (
            <p className="text-sm text-muted-foreground">
              Diese Einladung ist bereits {invite.status}.
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleAccept}
              disabled={
                wrongEmail ||
                notPending ||
                acceptMutation.loading ||
                rejectMutation.loading
              }
            >
              Annehmen
            </Button>
            <Button
              variant="outline"
              onClick={handleReject}
              disabled={
                wrongEmail ||
                notPending ||
                acceptMutation.loading ||
                rejectMutation.loading
              }
            >
              Ablehnen
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
