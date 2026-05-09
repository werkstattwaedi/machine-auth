// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  AlertTriangle,
  Check,
  Crown,
  Info,
  Mail,
  Plus,
  RefreshCw,
  User,
  Users,
  X,
} from "lucide-react"
import { httpsCallable } from "firebase/functions"
import { where } from "firebase/firestore"
import * as React from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { useAuth } from "@modules/lib/auth"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { useDocument, useCollection } from "@modules/lib/firestore"
import {
  membershipInvitesCollection,
  membershipsCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import { formatDate } from "@modules/lib/format"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Avatar } from "@modules/components/ui/avatar"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { PageLoading } from "@modules/components/page-loading"

export const Route = createFileRoute("/_authenticated/membership/")({
  component: MembershipPage,
})

function MembershipPage() {
  const db = useDb()
  const functions = useFunctions()
  const { userDoc } = useAuth()
  const navigate = useNavigate()

  // Page surfaces *any* membership the user is a member of, not just the
  // active one — so expired/cancelled docs render their own status hero.
  // `users/{uid}.activeMembership` is intentionally narrower (kept by the
  // onMembershipWritten trigger and used for pricing) so we can't reuse it
  // here. By invariant a user appears in `members[]` of at most one
  // membership; if more sneak in we pick the latest validUntil.
  const userId = userDoc?.id
  const { data: memberships, loading } = useCollection(
    userId ? membershipsCollection(db) : null,
    ...(userId
      ? [where("members", "array-contains", userRef(db, userId))]
      : []),
  )
  const membership =
    memberships.length === 0
      ? null
      : memberships.length === 1
        ? memberships[0]
        : [...memberships].sort(
            (a, b) => b.validUntil.toMillis() - a.validUntil.toMillis(),
          )[0]

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
      // TanStack Router's `useNavigate()` is typed against the calling app's
      // route tree; `as never` lets shared paths type-check.
      navigate({
        to: "/visit",
        search: { openCheckout: res.data.checkoutId } as never,
      } as never)
    })
  }

  if (loading) return <PageLoading />

  const isOwner = membership?.ownerUserId.id === userDoc?.id
  const isActive = membership?.status === "active"

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="font-heading font-bold text-3xl leading-tight">
        Mitgliedschaft
      </h1>

      {!membership ? (
        <NoMembership onPurchase={startPurchase} loading={purchase.loading} />
      ) : (
        <StatusHero
          type={membership.type}
          status={membership.status}
          validUntil={formatDate(membership.validUntil)}
          isOwner={isOwner}
          loading={purchase.loading}
          onRenew={() =>
            startPurchase(membership.type, membership.status === "active")
          }
        />
      )}

      {membership?.status === "expired" && (
        <Note kind="warn">
          Abgelaufen seit dem {formatDate(membership.validUntil)}. Beim
          nächsten Checkout zahlst du <strong>keinen Rabatt</strong>.
        </Note>
      )}

      {membership?.status === "cancelled" && (
        <Note kind="info">
          Durch die Vereinsverwaltung deaktiviert. Eine Reaktivierung kann nur
          die Vereinsverwaltung vornehmen.
        </Note>
      )}

      {membership && isActive && membership.type === "family" && isOwner && (
        <FamilySection
          membershipId={membership.id}
          memberIds={membership.members.map((m) => m.id)}
          ownerId={membership.ownerUserId.id}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Status hero — gold swash on the validity date when active          */
/* ------------------------------------------------------------------ */

function StatusHero({
  type,
  status,
  validUntil,
  isOwner,
  loading,
  onRenew,
}: {
  type: "single" | "family"
  status: "active" | "expired" | "cancelled"
  validUntil: string
  isOwner: boolean
  loading: boolean
  onRenew: () => void
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={type === "family" ? "default" : "secondary"}>
            {type === "family" ? <Users /> : <User />}
            {type === "family" ? "Familie" : "Einzel"}
          </Badge>
          {status === "active" && <Badge variant="success">Aktiv</Badge>}
          {status === "expired" && (
            <Badge variant="destructive">Abgelaufen</Badge>
          )}
          {status === "cancelled" && (
            <Badge variant="outline">Gekündigt</Badge>
          )}
        </div>

        <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Gültig bis
        </p>
        <h2 className="mt-1 inline-block font-heading text-4xl font-bold leading-none">
          {status === "active" ? (
            <span className="relative inline-block before:absolute before:inset-x-[-8px] before:top-[60%] before:z-0 before:h-[22px] before:-skew-x-12 before:-rotate-1 before:bg-oww-gold before:[clip-path:polygon(2%_14%,98%_4%,100%_86%,1%_96%)]">
              <span className="relative z-[1] tabular-nums">{validUntil}</span>
            </span>
          ) : (
            <span className="tabular-nums">{validUntil}</span>
          )}
        </h2>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {status === "active" && type === "family" && isOwner && (
              <>
                Du bist <strong className="text-foreground">Inhaber:in</strong>{" "}
                der Familie.
              </>
            )}
            {status === "active" && type === "family" && !isOwner && (
              <>
                Du bist Mitglied einer Familienmitgliedschaft. Vergünstigte
                Preise auf Maschinen und Material.
              </>
            )}
            {status === "active" && type === "single" && (
              <>Vergünstigte Preise auf Maschinen und Material.</>
            )}
            {status === "expired" && (
              <>Verlängere, um wieder Mitglieder-Preise zu erhalten.</>
            )}
            {status === "cancelled" && (
              <>Reaktivierung nur durch Admin möglich.</>
            )}
          </p>
          {(status === "active" || status === "expired") && (
            <Button onClick={onRenew} disabled={loading}>
              <RefreshCw />
              {status === "expired" ? "Erneuern" : "Verlängern"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* No-membership purchase entry                                       */
/* ------------------------------------------------------------------ */

function NoMembership({
  onPurchase,
  loading,
}: {
  onPurchase: (type: "single" | "family", renewExisting: boolean) => void
  loading: boolean
}) {
  const benefits: React.ReactNode[] = [
    <>
      <strong className="font-bold">Mitglieder-Preise</strong> auf alle
      Werkstätten und Material.
    </>,
    <>
      <strong className="font-bold">Familie:</strong> Bis zu 5 Erwachsene +
      Kinderkonten teilen sich die Mitgliedschaft.
    </>,
    <>
      <strong className="font-bold">Stimmrecht</strong> an der jährlichen
      Mitgliederversammlung.
    </>,
  ]

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div>
          <h2 className="font-heading text-xl font-bold">Mitglied werden</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Als Mitglied erhältst du vergünstigte Preise auf Maschinen und
            Material und unterstützt den Verein.
          </p>
        </div>

        <ul className="space-y-2.5">
          {benefits.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-cog-teal-light text-cog-teal-dark">
                <Check className="size-3" />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BuyCard
            eyebrow={
              <>
                <User className="inline size-3 align-[-2px]" /> Für dich
              </>
            }
            title="Einzel"
            description="Eine Person. Mitglieder-Preise auf alle Werkstätten und Material."
            price="50"
            onClick={() => onPurchase("single", false)}
            disabled={loading}
          />
          <BuyCard
            eyebrow={
              <>
                <Users className="inline size-3 align-[-2px]" /> Für deine
                Familie
              </>
            }
            title="Familie"
            description="Bis zu 5 Erwachsene + Kinderkonten. Alle bekommen Mitglieder-Preise."
            price="70"
            onClick={() => onPurchase("family", false)}
            disabled={loading}
          />
        </div>

        <Note kind="info">
          Bezahlt wird wie üblich beim Self-Checkout (Twint, Rechnung, Bar). Du
          wirst dorthin weitergeleitet.
        </Note>
      </CardContent>
    </Card>
  )
}

function BuyCard({
  eyebrow,
  title,
  description,
  price,
  onClick,
  disabled,
}: {
  eyebrow: React.ReactNode
  title: string
  description: string
  price: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col gap-2.5 rounded-xl border bg-card p-5 text-left transition hover:border-cog-teal hover:bg-cog-teal-light disabled:opacity-50"
    >
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {eyebrow}
      </span>
      <span className="font-heading text-[22px] font-bold leading-tight">
        {title}
      </span>
      <span className="text-sm leading-snug text-muted-foreground">
        {description}
      </span>
      <span className="mt-auto flex items-end justify-between pt-1">
        <span className="text-lg font-bold tabular-nums text-foreground">
          CHF {price}
          <span className="ml-0.5 text-xs font-medium text-muted-foreground">
            /Jahr
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-cog-teal-dark">
          Zum Checkout →
        </span>
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Inline family section (only for owner of an active family)         */
/* ------------------------------------------------------------------ */

function FamilySection({
  membershipId,
  memberIds,
  ownerId,
}: {
  membershipId: string
  memberIds: string[]
  ownerId: string
}) {
  const db = useDb()
  const functions = useFunctions()

  const { data: invites } = useCollection(
    membershipInvitesCollection(db, membershipId),
  )
  const pending = invites.filter((i) => i.status === "pending")

  const [inviteEmail, setInviteEmail] = React.useState("")
  const [showAddKid, setShowAddKid] = React.useState(false)
  const [kidFirst, setKidFirst] = React.useState("")
  const [kidLast, setKidLast] = React.useState("")

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

  const totalCount = memberIds.length

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.includes("@")) return
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
    if (!confirm("Diese Person aus der Familie entfernen?")) return
    await removeMutation.mutate(async () => {
      const fn = httpsCallable(functions, "removeFamilyMember")
      await fn({ membershipId, userId: uid })
    })
  }

  const handleCreateKid = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!kidFirst.trim() || !kidLast.trim()) return
    await createChildMutation.mutate(async () => {
      const fn = httpsCallable(functions, "createChildAccount")
      await fn({
        membershipId,
        firstName: kidFirst.trim(),
        lastName: kidLast.trim(),
      })
      setKidFirst("")
      setKidLast("")
      setShowAddKid(false)
    })
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-xl font-bold">Familie</h2>
          <span className="text-sm text-muted-foreground">
            {totalCount} {totalCount === 1 ? "Person" : "Personen"}
          </span>
        </div>

        <ul className="mt-2">
          {memberIds.map((uid) => (
            <MemberRow
              key={uid}
              userId={uid}
              isOwner={uid === ownerId}
              onRemove={
                uid === ownerId ? null : () => handleRemove(uid)
              }
              removing={removeMutation.loading}
            />
          ))}
          {pending.map((inv) => (
            <li
              key={inv.id}
              className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3 border-b py-3 opacity-90 last:border-0"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Mail className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {inv.email}
                </div>
                <div className="text-xs text-muted-foreground">
                  Eingeladen · läuft in 30 Tagen ab
                </div>
              </div>
              <Badge variant="outline">Ausstehend</Badge>
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

        <div className="mt-4 border-t pt-4">
          <form onSubmit={handleInvite} className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="invite-email" className="text-sm font-bold">
                Erwachsene Person einladen
              </Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="name@beispiel.ch"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button
              type="submit"
              disabled={
                !inviteEmail.includes("@") || inviteMutation.loading
              }
            >
              <Mail />
              Einladen
            </Button>
          </form>

          {!showAddKid ? (
            <button
              type="button"
              onClick={() => setShowAddKid(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-cog-teal-dark hover:underline"
            >
              <Plus className="size-3.5" />
              Kindkonto hinzufügen
            </button>
          ) : (
            <form onSubmit={handleCreateKid} className="mt-4">
              <div className="text-sm font-bold">
                Kindkonto erstellen{" "}
                <span className="font-normal text-muted-foreground">
                  · kein eigenes Login
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                <div>
                  <Label htmlFor="kid-first" className="sr-only">
                    Vorname
                  </Label>
                  <Input
                    id="kid-first"
                    autoFocus
                    placeholder="Vorname"
                    value={kidFirst}
                    onChange={(e) => setKidFirst(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="kid-last" className="sr-only">
                    Nachname
                  </Label>
                  <Input
                    id="kid-last"
                    placeholder="Nachname"
                    value={kidLast}
                    onChange={(e) => setKidLast(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    !kidFirst.trim() ||
                    !kidLast.trim() ||
                    createChildMutation.loading
                  }
                >
                  <Plus />
                  Erstellen
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowAddKid(false)
                    setKidFirst("")
                    setKidLast("")
                  }}
                >
                  Abbrechen
                </Button>
              </div>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
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
    <li className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3 border-b py-3 last:border-0">
      <Avatar name={displayName} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{displayName}</div>
        <div className="text-xs text-muted-foreground">
          {user?.email ?? <span>(kein Login)</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {isOwner && (
          <Badge variant="gold">
            <Crown />
            Inhaber:in
          </Badge>
        )}
        {isChild && !isOwner && <Badge variant="secondary">Kind</Badge>}
      </div>
      <div>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={removing}
          >
            <X />
            Entfernen
          </Button>
        )}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Local note callout                                                 */
/* ------------------------------------------------------------------ */

function Note({
  kind,
  children,
}: {
  kind: "info" | "warn"
  children: React.ReactNode
}) {
  const Icon = kind === "warn" ? AlertTriangle : Info
  const styles =
    kind === "warn"
      ? "bg-destructive/10 text-[#7a1a16] [&>svg]:text-destructive"
      : "bg-cog-teal-light text-[#134f54] [&>svg]:text-cog-teal-dark"
  return (
    <div
      className={`flex items-start gap-2.5 rounded-md px-3.5 py-3 text-sm leading-relaxed ${styles}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}
