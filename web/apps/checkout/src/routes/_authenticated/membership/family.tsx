// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Family roster: members list, invite by email, remove member, create child.
 * Visible only when the signed-in user is the `ownerUserId` of an active
 * family membership.
 */

import { createFileRoute, Link } from "@tanstack/react-router"
import { useDocument, useCollection } from "@modules/lib/firestore"
import {
  membershipRef,
  membershipInvitesCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { useAuth } from "@modules/lib/auth"
import { PageLoading } from "@modules/components/page-loading"
import { Card, CardContent } from "@modules/components/ui/card"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { httpsCallable } from "firebase/functions"
import { useState } from "react"

export const Route = createFileRoute("/_authenticated/membership/family")({
  component: FamilyPage,
})

function FamilyPage() {
  const db = useDb()
  const functions = useFunctions()
  const { userDoc } = useAuth()

  const { data: membership, loading } = useDocument(
    userDoc?.activeMembership ? membershipRef(db, userDoc.activeMembership) : null,
  )
  const { data: invites } = useCollection(
    userDoc?.activeMembership
      ? membershipInvitesCollection(db, userDoc.activeMembership)
      : null,
  )

  const [inviteEmail, setInviteEmail] = useState("")
  const [childFirst, setChildFirst] = useState("")
  const [childLast, setChildLast] = useState("")

  const inviteMutation = useAsyncMutation({
    context: "checkout.inviteFamily",
    successMessage: "Einladung gesendet",
    errorMessage: "Einladung fehlgeschlagen",
  })
  const revokeMutation = useAsyncMutation({
    context: "checkout.revokeFamilyInvite",
    successMessage: "Einladung zurückgezogen",
    errorMessage: "Einladung konnte nicht zurückgezogen werden",
  })
  const removeMutation = useAsyncMutation({
    context: "checkout.removeFamilyMember",
    successMessage: "Mitglied entfernt",
    errorMessage: "Mitglied konnte nicht entfernt werden",
  })
  const createChildMutation = useAsyncMutation({
    context: "checkout.createChildAccount",
    successMessage: "Kindkonto erstellt",
    errorMessage: "Kindkonto konnte nicht erstellt werden",
  })

  if (loading) return <PageLoading />
  if (!membership || membership.type !== "family") {
    return (
      <div className="max-w-2xl">
        <p>Du hast keine Familienmitgliedschaft.</p>
        <Link to={"/membership" as never} className="text-primary hover:underline">
          Zur Mitgliedschaft
        </Link>
      </div>
    )
  }
  if (membership.ownerUserId.id !== userDoc?.id) {
    return (
      <div className="max-w-2xl">
        <p>Nur die Inhaber:in der Familienmitgliedschaft kann diese Seite öffnen.</p>
      </div>
    )
  }

  const membershipId = userDoc.activeMembership!

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    await inviteMutation.mutate(async () => {
      const fn = httpsCallable<
        { membershipId: string; email: string },
        { inviteId: string }
      >(functions, "inviteFamilyMember")
      await fn({ membershipId, email: inviteEmail.trim() })
      setInviteEmail("")
    })
  }

  const handleRevoke = async (inviteId: string) => {
    await revokeMutation.mutate(async () => {
      const fn = httpsCallable(functions, "revokeFamilyInvite")
      await fn({ membershipId, inviteId })
    })
  }

  const handleRemove = async (uid: string) => {
    if (!confirm("Mitglied wirklich entfernen?")) return
    await removeMutation.mutate(async () => {
      const fn = httpsCallable(functions, "removeFamilyMember")
      await fn({ membershipId, userId: uid })
    })
  }

  const handleCreateChild = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!childFirst.trim() || !childLast.trim()) return
    await createChildMutation.mutate(async () => {
      const fn = httpsCallable(functions, "createChildAccount")
      await fn({
        membershipId,
        firstName: childFirst.trim(),
        lastName: childLast.trim(),
      })
      setChildFirst("")
      setChildLast("")
    })
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">Familie verwalten</h1>

      <Card className="mb-4">
        <CardContent className="pt-6">
          <h2 className="font-medium mb-3">Mitglieder</h2>
          <ul className="space-y-2">
            {membership.members.map((m) => (
              <MemberRow
                key={m.id}
                userId={m.id}
                isOwner={m.id === membership.ownerUserId.id}
                onRemove={
                  m.id === membership.ownerUserId.id
                    ? null
                    : () => handleRemove(m.id)
                }
                removing={removeMutation.loading}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="pt-6">
          <h2 className="font-medium mb-3">Person einladen</h2>
          <form onSubmit={handleInvite} className="flex gap-2">
            <Input
              type="email"
              placeholder="E-Mail-Adresse"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={inviteMutation.loading}>
              Einladen
            </Button>
          </form>
          {invites.some((i) => i.status === "pending") && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">Offene Einladungen</h3>
              <ul className="space-y-1 text-sm">
                {invites
                  .filter((i) => i.status === "pending")
                  .map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between"
                    >
                      <span className="font-mono">{inv.email}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(inv.id)}
                        disabled={revokeMutation.loading}
                      >
                        Zurückziehen
                      </Button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="font-medium mb-3">Kindkonto erstellen</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Für Kinder ohne eigene E-Mail-Adresse. Du kannst das Konto später
            zu einem regulären Konto umwandeln, indem du eine E-Mail-Adresse
            hinzufügst.
          </p>
          <form
            onSubmit={handleCreateChild}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            <div>
              <Label htmlFor="childFirst" className="text-xs">Vorname</Label>
              <Input
                id="childFirst"
                value={childFirst}
                onChange={(e) => setChildFirst(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="childLast" className="text-xs">Nachname</Label>
              <Input
                id="childLast"
                value={childLast}
                onChange={(e) => setChildLast(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={createChildMutation.loading}
                className="w-full"
              >
                Erstellen
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function MemberRow({
  userId,
  isOwner,
  onRemove,
  removing,
}: {
  userId: string
  isOwner: boolean
  onRemove: (() => void) | null
  removing: boolean
}) {
  const db = useDb()
  // Family-roster join rule allows reading co-members' user docs.
  const { data: user } = useDocument(userRef(db, userId))
  const displayName =
    user?.displayName ||
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
    userId
  const isChild = user?.userType === "kind"
  return (
    <li className="flex items-center justify-between text-sm border-b last:border-0 py-2">
      <div>
        <span className="font-medium">{displayName}</span>{" "}
        <span className="text-muted-foreground">
          {user?.email ?? "(kein Login)"}
        </span>
        {isChild && (
          <Badge variant="outline" className="ml-2">
            Kind
          </Badge>
        )}
        {isOwner && (
          <Badge variant="outline" className="ml-2">
            Inhaber:in
          </Badge>
        )}
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={removing}
        >
          Entfernen
        </Button>
      )}
    </li>
  )
}
