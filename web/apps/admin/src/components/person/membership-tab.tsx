// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person · Mitgliedschaft — the shared membership this person belongs
// to, managed inline (no separate memberships area). Create when none;
// otherwise focused actions: verlängern, Auto-Verlängerung beenden,
// kündigen. Family memberships show the roster + open invites.
// All mutations flow through membershipCall (client writes are denied).

import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { rpcCallable } from "@modules/lib/rpc"
import { useFunctions, useDb } from "@modules/lib/firebase-context"
import { useCollection } from "@modules/lib/firestore"
import { membershipInvitesCollection } from "@modules/lib/firestore-helpers"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import type {
  MembershipDoc,
  MembershipType,
  UserDoc,
} from "@modules/lib/firestore-entities"
import { useLookup, resolveRef } from "@modules/lib/lookup"
import { formatDate, formatDateTime } from "@modules/lib/format"
import { formatFullName } from "@modules/lib/username-utils"
import { Avatar } from "@modules/components/ui/avatar"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { ConfirmDialog } from "@modules/components/confirm-dialog"
import { EmptyState } from "@modules/components/empty-state"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import {
  BadgeX,
  CalendarPlus,
  Loader2,
  Mail,
  Plus,
  UserMinus,
} from "lucide-react"

export function PersonMembershipTab({
  userId,
  user,
  membership,
}: {
  userId: string
  user: UserDoc
  membership: (MembershipDoc & { id: string }) | null
}) {
  if (!membership || membership.status !== "active") {
    return (
      <div className="mt-2 max-w-xl space-y-4">
        {membership && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Letzte Mitgliedschaft:{" "}
              {membership.type === "family" ? "Familie" : "Einzel"} ·{" "}
              {membership.status === "expired" ? "abgelaufen" : "gekündigt"} per{" "}
              {formatDate(membership.validUntil)}
            </CardContent>
          </Card>
        )}
        <CreateMembershipCard userId={userId} user={user} />
      </div>
    )
  }
  return <ActiveMembershipView userId={userId} membership={membership} />
}

function CreateMembershipCard({
  userId,
  user,
}: {
  userId: string
  user: UserDoc
}) {
  const functions = useFunctions()
  const [type, setType] = useState<MembershipType>("single")
  const create = useAsyncMutation<{ membershipId: string }>({
    context: "admin.createMembership",
    successMessage: "Mitgliedschaft erstellt",
    errorMessage: "Mitgliedschaft konnte nicht erstellt werden",
  })

  const handleCreate = async () => {
    try {
      await create.mutate(async () => {
        const fn = rpcCallable<
          { type: MembershipType; ownerUserId: string },
          { membershipId: string }
        >(functions, "membershipCall", "adminCreateMembership")
        const res = await fn({ type, ownerUserId: userId })
        return res.data
      })
    } catch {
      // Hook already toasted + reported telemetry.
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <EmptyState
          icon={BadgeX}
          title="Keine aktive Mitgliedschaft"
          description={`${formatFullName(user, "Diese Person")} ist aktuell kein Mitglied. Die Mitgliedschaft gilt ein Jahr ab heute; die Zahlung wird manuell abgewickelt (z.B. Banküberweisung).`}
        />
        <div className="space-y-2">
          <Label>Typ</Label>
          <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
            {(["single", "family"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors " +
                  (type === t ? "bg-background shadow-sm" : "text-muted-foreground")
                }
              >
                {t === "single" ? "Einzel" : "Familie"}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={handleCreate} disabled={create.loading}>
          {create.loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Mitgliedschaft erstellen
        </Button>
      </CardContent>
    </Card>
  )
}

function ActiveMembershipView({
  userId,
  membership,
}: {
  userId: string
  membership: MembershipDoc & { id: string }
}) {
  const functions = useFunctions()
  const db = useDb()
  const { users } = useLookup()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [removeMember, setRemoveMember] = useState<{
    id: string
    name: string
  } | null>(null)
  const [inviteEmail, setInviteEmail] = useState("")

  const { data: invites } = useCollection(
    membershipInvitesCollection(db, membership.id),
  )
  const pendingInvites = invites.filter((i) => i.status === "pending")

  const extend = useAsyncMutation({
    context: "admin.extendMembership",
    successMessage: "Mitgliedschaft um 1 Jahr verlängert",
    errorMessage: "Mitgliedschaft konnte nicht verlängert werden",
  })
  const cancelAutoRenew = useAsyncMutation({
    context: "admin.cancelMembershipAutoRenew",
    successMessage: "Automatische Verlängerung beendet",
    errorMessage: "Verlängerung konnte nicht beendet werden",
  })
  const cancel = useAsyncMutation({
    context: "admin.cancelMembership",
    successMessage: "Mitgliedschaft gekündigt",
    errorMessage: "Mitgliedschaft konnte nicht gekündigt werden",
  })
  const remove = useAsyncMutation({
    context: "admin.removeFamilyMember",
    successMessage: "Mitglied entfernt",
    errorMessage: "Mitglied konnte nicht entfernt werden",
  })
  const invite = useAsyncMutation({
    context: "admin.inviteFamilyMember",
    successMessage: "Einladung versendet",
    errorMessage: "Einladung konnte nicht versendet werden",
  })

  const call = async (method: string, payload: Record<string, unknown>) => {
    const fn = rpcCallable<Record<string, unknown>, unknown>(
      functions,
      "membershipCall",
      method,
    )
    await fn(payload)
  }

  const autoRenewOn = membership.autoRenew !== false
  const isOwner = membership.ownerUserId.id === userId

  return (
    <div className="mt-2 max-w-2xl space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-2.5">
            <h3 className="font-heading text-lg font-bold">
              {membership.type === "family"
                ? "Familienmitgliedschaft"
                : "Einzelmitgliedschaft"}
            </h3>
            <Badge variant="secondary">aktiv</Badge>
            {membership.pendingRenewalBill && (
              <Badge className="bg-oww-gold-light text-oww-gold-text border-oww-gold-border">
                Verlängerungsrechnung offen
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Fact label="Gültig bis" value={formatDate(membership.validUntil)} />
            <Fact
              label="Autom. Verlängerung"
              value={autoRenewOn ? "aktiv" : "beendet"}
            />
            <Fact
              label="Letzte Zahlung"
              value={
                membership.lastPaidAt ? formatDate(membership.lastPaidAt) : "–"
              }
            />
            <Fact
              label="Inhaber:in"
              value={
                isOwner ? "diese Person" : resolveRef(users, membership.ownerUserId)
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                extend
                  .mutate(() =>
                    call("adminExtendMembership", {
                      membershipId: membership.id,
                      days: 365,
                    }),
                  )
                  .catch(() => {})
              }
              disabled={extend.loading}
            >
              <CalendarPlus className="mr-2 h-4 w-4" />
              +1 Jahr verlängern
            </Button>
            {autoRenewOn && (
              <Button
                variant="outline"
                onClick={() =>
                  cancelAutoRenew
                    .mutate(() =>
                      call("cancelMembershipAutoRenew", {
                        membershipId: membership.id,
                      }),
                    )
                    .catch(() => {})
                }
                disabled={cancelAutoRenew.loading}
              >
                Auto-Verlängerung beenden
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => setConfirmCancel(true)}
              disabled={cancel.loading}
            >
              Kündigen
            </Button>
          </div>
        </CardContent>
      </Card>

      {membership.type === "family" && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h3 className="text-sm font-semibold">
              Mitglieder · {membership.members?.length ?? 0}
            </h3>
            <ul className="divide-y">
              {membership.members?.map((memberRef) => {
                const name = resolveRef(users, memberRef)
                const owner = membership.ownerUserId.id === memberRef.id
                return (
                  <li key={memberRef.id} className="flex items-center gap-3 py-2">
                    <Avatar name={name} seed={memberRef.id} size="sm" />
                    <Link
                      to="/users/$userId"
                      params={{ userId: memberRef.id }}
                      className="flex-1 text-sm font-medium hover:underline"
                    >
                      {name}
                    </Link>
                    {owner ? (
                      <Badge variant="secondary">Inhaber:in</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setRemoveMember({ id: memberRef.id, name })}
                        disabled={remove.loading}
                      >
                        <UserMinus className="mr-1 h-3.5 w-3.5" />
                        Entfernen
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>

            {pendingInvites.length > 0 && (
              <div className="space-y-1 border-t pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Offene Einladungen
                </div>
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono">{inv.email}</span>
                    <span className="text-xs text-muted-foreground">
                      eingeladen {formatDateTime(inv.invitedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <form
              className="flex gap-2 border-t pt-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!inviteEmail.trim()) return
                invite
                  .mutate(() =>
                    call("inviteFamilyMember", {
                      membershipId: membership.id,
                      email: inviteEmail.trim(),
                    }),
                  )
                  .then(() => setInviteEmail(""))
                  .catch(() => {})
              }}
            >
              <Input
                type="email"
                placeholder="mitglied@example.ch"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="max-w-xs"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={invite.loading || !inviteEmail.trim()}
              >
                {invite.loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                Mitglied einladen
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Mitgliedschaft kündigen?"
        description="Die Mitgliedschaft wird sofort beendet; der Mitglieder-Rabatt entfällt für alle Mitglieder."
        confirmLabel="Kündigen"
        destructive
        onConfirm={() =>
          cancel
            .mutate(() => call("cancelMembership", { membershipId: membership.id }))
            .catch(() => {})
        }
      />
      <ConfirmDialog
        open={!!removeMember}
        onOpenChange={(open) => !open && setRemoveMember(null)}
        title="Mitglied entfernen?"
        description={`${removeMember?.name ?? ""} wird aus der Familienmitgliedschaft entfernt.`}
        confirmLabel="Entfernen"
        destructive
        onConfirm={() => {
          if (!removeMember) return
          void remove
            .mutate(() =>
              call("removeFamilyMember", {
                membershipId: membership.id,
                userId: removeMember.id,
              }),
            )
            .catch(() => {})
            .finally(() => setRemoveMember(null))
        }}
      />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-heading font-bold">{value}</div>
    </div>
  )
}
