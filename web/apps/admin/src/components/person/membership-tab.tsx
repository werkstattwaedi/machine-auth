// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Person · Mitgliedschaft — the shared membership this person belongs
// to, managed inline (no separate memberships area). Create when none;
// otherwise focused actions: verlängern, Auto-Verlängerung beenden,
// kündigen. Family memberships show the roster + open invites.
// An admin never invites by e-mail (#622): the invitation is signed with
// the caller's name, so it would go out "from" the admin. Instead the
// admin adds an existing person directly or creates a login-less one.
// All mutations flow through membershipCall (client writes are denied).

import { useState, type FormEvent } from "react"
import { Link } from "@tanstack/react-router"
import { rpcCallable } from "@modules/lib/rpc"
import { useFunctions, useDb } from "@modules/lib/firebase-context"
import { useCollection } from "@modules/lib/firestore"
import {
  membershipInvitesCollection,
  usersCollection,
} from "@modules/lib/firestore-helpers"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@modules/components/ui/select"
import {
  BadgeX,
  CalendarPlus,
  Loader2,
  Plus,
  UserMinus,
  UserPlus,
} from "lucide-react"

/** Managed members are login-less; firma always needs a real login. */
type ManagedMemberType = "erwachsen" | "kind"
/** `closed` = collapsed to the "Mitglied hinzufügen" button. */
type AddMode = "closed" | "existing" | "no-login"

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
  const [addMode, setAddMode] = useState<AddMode>("closed")
  const [pickedUserId, setPickedUserId] = useState("")
  const [noLoginFirst, setNoLoginFirst] = useState("")
  const [noLoginLast, setNoLoginLast] = useState("")
  const [noLoginType, setNoLoginType] = useState<ManagedMemberType>("erwachsen")

  const { data: invites } = useCollection(
    membershipInvitesCollection(db, membership.id),
  )
  const pendingInvites = invites.filter((i) => i.status === "pending")

  // Same query LookupProvider already streams, so this shares its watch.
  // Eligibility mirrors the server invariant only (one active membership
  // per person). Login-less people stay eligible: re-adding a previously
  // removed managed member is a legitimate admin action.
  const { data: allUsers } = useCollection(usersCollection(db))
  const memberIds = new Set(membership.members?.map((m) => m.id) ?? [])
  const eligibleUsers = allUsers
    .filter((u) => !u.activeMembership && !memberIds.has(u.id))
    .map((u) => ({ id: u.id, name: formatFullName(u, u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"))

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
  const addExisting = useAsyncMutation({
    context: "admin.addFamilyMember",
    successMessage: "Mitglied hinzugefügt",
    errorMessage: "Mitglied konnte nicht hinzugefügt werden",
  })
  const createNoLogin = useAsyncMutation({
    context: "admin.createManagedMember",
    successMessage: "Mitglied hinzugefügt",
    errorMessage: "Mitglied konnte nicht erstellt werden",
  })
  const revokeInvite = useAsyncMutation({
    context: "admin.revokeFamilyInvite",
    successMessage: "Einladung zurückgezogen",
    errorMessage: "Einladung konnte nicht zurückgezogen werden",
  })

  const call = async (method: string, payload: Record<string, unknown>) => {
    const fn = rpcCallable<Record<string, unknown>, unknown>(
      functions,
      "membershipCall",
      method,
    )
    await fn(payload)
  }

  const resetAdd = () => {
    setAddMode("closed")
    setPickedUserId("")
    setNoLoginFirst("")
    setNoLoginLast("")
    setNoLoginType("erwachsen")
  }

  // On failure the hook toasts and re-throws (ADR-0025), so the form stays
  // open with its input intact; only a success collapses it.
  const handleAddExisting = () => {
    if (!pickedUserId) return
    addExisting
      .mutate(() =>
        call("adminAddFamilyMember", {
          membershipId: membership.id,
          userId: pickedUserId,
        }),
      )
      .then(resetAdd)
      .catch(() => {})
  }

  const handleCreateNoLogin = (e: FormEvent) => {
    e.preventDefault()
    if (!noLoginFirst.trim() || !noLoginLast.trim()) return
    createNoLogin
      .mutate(() =>
        call("createManagedMember", {
          membershipId: membership.id,
          firstName: noLoginFirst.trim(),
          lastName: noLoginLast.trim(),
          userType: noLoginType,
        }),
      )
      .then(resetAdd)
      .catch(() => {})
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
                    <span>{inv.email}</span>
                    <span className="flex-1 text-xs text-muted-foreground">
                      eingeladen {formatDateTime(inv.invitedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        revokeInvite
                          .mutate(() =>
                            call("revokeFamilyInvite", {
                              membershipId: membership.id,
                              inviteId: inv.id,
                            }),
                          )
                          .catch(() => {})
                      }
                      disabled={revokeInvite.loading}
                    >
                      Zurückziehen
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3 border-t pt-3">
              {addMode === "closed" && (
                <Button variant="outline" onClick={() => setAddMode("existing")}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Mitglied hinzufügen
                </Button>
              )}

              {addMode !== "closed" && (
                <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
                  {(["existing", "no-login"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAddMode(m)}
                      className={
                        "rounded-md px-4 py-1.5 text-sm font-medium transition-colors " +
                        (addMode === m
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground")
                      }
                    >
                      {m === "existing" ? "Bestehende Person" : "Ohne Login"}
                    </button>
                  ))}
                </div>
              )}

              {addMode === "existing" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Select value={pickedUserId} onValueChange={setPickedUserId}>
                      <SelectTrigger className="max-w-72">
                        <SelectValue placeholder="Person wählen …" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleAddExisting}
                      disabled={!pickedUserId || addExisting.loading}
                    >
                      {addExisting.loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      Hinzufügen
                    </Button>
                    <Button variant="ghost" onClick={resetAdd}>
                      Abbrechen
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Nur Personen ohne aktive Mitgliedschaft. Es wird keine
                    E-Mail versendet.
                  </p>
                </div>
              )}

              {addMode === "no-login" && (
                <form className="space-y-3" onSubmit={handleCreateNoLogin}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="no-login-first">Vorname</Label>
                      <Input
                        id="no-login-first"
                        value={noLoginFirst}
                        onChange={(e) => setNoLoginFirst(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="no-login-last">Nachname</Label>
                      <Input
                        id="no-login-last"
                        value={noLoginLast}
                        onChange={(e) => setNoLoginLast(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Typ</Label>
                    <div className="inline-flex gap-0.5 rounded-lg bg-muted p-1">
                      {(["erwachsen", "kind"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setNoLoginType(t)}
                          className={
                            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors " +
                            (noLoginType === t
                              ? "bg-background shadow-sm"
                              : "text-muted-foreground")
                          }
                        >
                          {t === "erwachsen" ? "Erwachsen" : "Kind"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={
                        createNoLogin.loading ||
                        !noLoginFirst.trim() ||
                        !noLoginLast.trim()
                      }
                    >
                      {createNoLogin.loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      Person erstellen
                    </Button>
                    <Button type="button" variant="ghost" onClick={resetAdd}>
                      Abbrechen
                    </Button>
                  </div>
                </form>
              )}
            </div>
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
