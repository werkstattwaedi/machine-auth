// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, Link } from "@tanstack/react-router"
import { useDocument, useCollection } from "@modules/lib/firestore"
import {
  membershipRef,
  membershipInvitesCollection,
} from "@modules/lib/firestore-helpers"
import { useDb } from "@modules/lib/firebase-context"
import { PageLoading } from "@modules/components/page-loading"
import { PageHeader } from "@/components/admin/page-header"
import { Card, CardContent } from "@modules/components/ui/card"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { formatDate, formatDateTime } from "@modules/lib/format"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { httpsCallable } from "firebase/functions"
import { useFunctions } from "@modules/lib/firebase-context"

export const Route = createFileRoute(
  "/_authenticated/memberships/$membershipId",
)({
  component: MembershipDetailPage,
})

function MembershipDetailPage() {
  const { membershipId } = Route.useParams()
  const db = useDb()
  const functions = useFunctions()

  const { data: membership, loading } = useDocument(
    membershipRef(db, membershipId),
  )
  const { data: invites } = useCollection(
    membershipInvitesCollection(db, membershipId),
  )

  const cancelMutation = useAsyncMutation({
    context: "admin.cancelMembership",
    successMessage: "Mitgliedschaft gekündigt",
    errorMessage: "Mitgliedschaft konnte nicht gekündigt werden",
  })
  const extendMutation = useAsyncMutation({
    context: "admin.extendMembership",
    successMessage: "Mitgliedschaft verlängert",
    errorMessage: "Mitgliedschaft konnte nicht verlängert werden",
  })

  if (loading) return <PageLoading />
  if (!membership) return <div>Mitgliedschaft nicht gefunden.</div>

  const handleCancel = async () => {
    if (!confirm("Mitgliedschaft wirklich kündigen?")) return
    await cancelMutation.mutate(async () => {
      const fn = httpsCallable<{ membershipId: string }, { ok: true }>(
        functions,
        "cancelMembership",
      )
      await fn({ membershipId })
    })
  }

  const handleExtendOneYear = async () => {
    await extendMutation.mutate(async () => {
      const fn = httpsCallable<
        { membershipId: string; days?: number },
        { validUntilMs: number }
      >(functions, "adminExtendMembership")
      await fn({ membershipId, days: 365 })
    })
  }

  return (
    <div>
      <PageHeader
        title={`Mitgliedschaft ${membershipId.slice(0, 8)}`}
        backTo="/memberships"
        backLabel="Zurück zu Mitgliedschaften"
      />

      <Card className="mb-4">
        <CardContent className="pt-6 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Typ">
              <Badge variant={membership.type === "family" ? "default" : "secondary"}>
                {membership.type === "family" ? "Familie" : "Einzel"}
              </Badge>
            </Field>
            <Field label="Status">
              <Badge
                variant={
                  membership.status === "active"
                    ? "default"
                    : membership.status === "expired"
                      ? "destructive"
                      : "outline"
                }
              >
                {membership.status}
              </Badge>
            </Field>
            <Field label="Inhaber:in">
              <Link
                to="/users/$userId"
                params={{ userId: membership.ownerUserId.id }}
                className="font-mono hover:underline"
              >
                {membership.ownerUserId.id}
              </Link>
            </Field>
            <Field label="Gültig bis">{formatDate(membership.validUntil)}</Field>
            <Field label="Letzte Zahlung">
              {formatDateTime(membership.lastPaidAt ?? null)}
            </Field>
            <Field label="Mitglieder">{membership.members?.length ?? 0}</Field>
          </div>
          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={handleExtendOneYear}
              disabled={extendMutation.loading}
            >
              +1 Jahr verlängern
            </Button>
            {membership.status !== "cancelled" && (
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={cancelMutation.loading}
              >
                Kündigen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="pt-6">
          <h2 className="font-medium mb-3">Mitglieder</h2>
          <ul className="space-y-1 text-sm">
            {membership.members?.map((m) => (
              <li key={m.id}>
                <Link
                  to="/users/$userId"
                  params={{ userId: m.id }}
                  className="font-mono hover:underline"
                >
                  {m.id}
                </Link>
                {membership.ownerUserId.id === m.id && (
                  <Badge variant="outline" className="ml-2">
                    Inhaber:in
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {membership.type === "family" && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="font-medium mb-3">Einladungen</h2>
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine Einladungen.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {invites.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center gap-3"
                  >
                    <span className="font-mono">{inv.email}</span>
                    <Badge variant="outline">{inv.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(inv.invitedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}
