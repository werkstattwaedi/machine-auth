// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  Crown,
  Info,
  LogIn,
  Plus,
  RefreshCw,
  Send,
  User,
  Users,
  X,
} from "lucide-react"
import { rpcCallable } from "@modules/lib/rpc"
import { where } from "firebase/firestore"
import * as React from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"

import { useAuth } from "@modules/lib/auth"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { useDocument, useCollection } from "@modules/lib/firestore"
import {
  catalogReferencesRef,
  checkoutItemsCollection,
  checkoutsCollection,
  membershipInvitesCollection,
  membershipsCollection,
  userRef,
} from "@modules/lib/firestore-helpers"
import type { CatalogItemDoc } from "@modules/lib/firestore-entities"
import type { DocumentReference } from "firebase/firestore"
import { priceForTier, USER_TYPE_LABELS } from "@modules/lib/pricing"
import { formatDate, formatRelativeTime } from "@modules/lib/format"
import { formatFullName } from "@modules/lib/username-utils"
import { cn } from "@modules/lib/utils"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Avatar } from "@modules/components/ui/avatar"
import { Badge } from "@modules/components/ui/badge"
import { Button } from "@modules/components/ui/button"
import { Card, CardContent } from "@modules/components/ui/card"
import { ConfirmDialog } from "@modules/components/confirm-dialog"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { PageLoading } from "@modules/components/page-loading"

export const Route = createFileRoute("/_authenticated/account/membership")({
  component: MembershipPage,
})

function MembershipPage() {
  const db = useDb()
  const functions = useFunctions()
  const { userDoc } = useAuth()
  const navigate = useNavigate()

  const userId = userDoc?.id
  const ref = userId ? userRef(db, userId) : null

  // Page surfaces *any* membership the user is a member of, not just the
  // active one — so expired/cancelled docs render their own status hero.
  // `users/{uid}.activeMembership` is intentionally narrower (kept by the
  // onMembershipWritten trigger and used for pricing) so we can't reuse it
  // here. By invariant a user appears in `members[]` of at most one
  // membership; if more sneak in we pick the latest validUntil.
  const { data: memberships, loading } = useCollection(
    ref ? membershipsCollection(db) : null,
    ...(ref ? [where("members", "array-contains", ref)] : []),
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
  const cancelAutoRenew = useAsyncMutation({
    context: "checkout.cancelMembershipAutoRenew",
    successMessage: "Automatische Verlängerung beendet",
    errorMessage: "Verlängerung konnte nicht beendet werden",
  })

  // Detect a membership SKU already sitting in the user's open checkout so
  // we can hide the buy buttons and route the user to the summary step
  // instead of letting them double-add. Server-side `purchaseMembership`
  // also rejects duplicates with `already-exists`; this is the friendly UX
  // layer (and a defense against the toast that the server-side raise
  // would produce).
  const { data: openCheckouts } = useCollection(
    ref ? checkoutsCollection(db) : null,
    ...(ref
      ? [where("userId", "==", ref), where("status", "==", "open")]
      : []),
  )
  const openCheckout = openCheckouts[0] ?? null
  const { data: openCheckoutItems } = useCollection(
    openCheckout ? checkoutItemsCollection(db, openCheckout.id) : null,
  )
  // Resolve the membership catalog item via `config/catalog-references`
  // (same indirection `config/pricing` uses for entry fees). Then read
  // the catalog doc itself for prices. Two reactive reads chained; both
  // null-tolerant. The previous collection-group `where("kind", "in",
  // [...])` query is gone — the two membership types live as variants
  // on the one referenced doc.
  const { data: catalogRefsDoc } = useDocument(catalogReferencesRef(db))
  const membershipDocRef =
    catalogRefsDoc?.membership as DocumentReference<CatalogItemDoc> | undefined
  const { data: membershipCatalog } = useDocument(membershipDocRef ?? null)
  // Renewals get the member tier (server enforces this too); first-time
  // signups pay default. Mirrors the tier resolution in `purchase.ts`.
  const discountLevel = userDoc?.activeMembership ? "member" : "none"
  const membershipPriceByType: Record<"single" | "family", string> =
    React.useMemo(() => {
      const lookup = (id: "single" | "family") => {
        const v = membershipCatalog?.variants?.find((x) => x.id === id)
        return v ? String(priceForTier(v.unitPrice, discountLevel)) : "—"
      }
      return { single: lookup("single"), family: lookup("family") }
    }, [membershipCatalog, discountLevel])
  const pendingMembershipType: "single" | "family" | null = React.useMemo(() => {
    const membershipId = membershipDocRef?.id
    if (!membershipId) return null
    for (const item of openCheckoutItems) {
      if (item.catalogId?.id !== membershipId) continue
      if (item.variantId === "single") return "single"
      if (item.variantId === "family") return "family"
    }
    return null
  }, [openCheckoutItems, membershipDocRef])

  const startPurchase = async (
    type: "single" | "family",
    renewExisting: boolean,
  ) => {
    await purchase.mutate(async () => {
      const fn = rpcCallable<
        { type: "single" | "family"; renewExisting?: boolean },
        { checkoutId: string }
      >(functions, "membershipCall", "purchaseMembership")
      await fn({ type, renewExisting })
      // The membership SKU is appended to the user's open checkout (or a
      // fresh `materialbezug` checkout). Land directly on the checkout
      // summary so the user can review and pay in one click.
      navigate({ to: "/checkout" })
    })
  }

  // Issue #323: renewals are now auto-invoiced ~30 days before validUntil
  // by the renewalInvoicer cron — the member can opt out of the next
  // invoice (membership stays active until validUntil).
  const handleCancelAutoRenew = async (membershipId: string) => {
    if (
      !confirm(
        "Automatische Verlängerung beenden? Deine Mitgliedschaft bleibt bis zum Ablaufdatum aktiv, wird danach aber nicht mehr automatisch verlängert.",
      )
    )
      return
    try {
      await cancelAutoRenew.mutate(async () => {
        const fn = rpcCallable<{ membershipId: string }, { ok: true }>(
          functions,
          "membershipCall",
          "cancelMembershipAutoRenew",
        )
        await fn({ membershipId })
      })
    } catch {
      // Hook already toasted + reported telemetry; nothing else to advance.
    }
  }

  if (loading) return <PageLoading />

  const isOwner = membership?.ownerUserId.id === userDoc?.id
  const isActive = membership?.status === "active"

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="font-heading font-bold text-3xl leading-tight">
        Mitgliedschaft
      </h1>

      <PendingInvitesBanner />

      {pendingMembershipType ? (
        <PendingMembershipCheckout type={pendingMembershipType} />
      ) : !membership ? (
        <NoMembership
          onPurchase={startPurchase}
          loading={purchase.loading}
          priceByType={membershipPriceByType}
        />
      ) : (
        <StatusHero
          type={membership.type}
          status={membership.status}
          validUntil={formatDate(membership.validUntil)}
          isOwner={isOwner}
          // autoRenew defaults to true when the field is absent (legacy docs).
          autoRenew={membership.autoRenew !== false}
          loading={purchase.loading || cancelAutoRenew.loading}
          // Expired/cancelled memberships are no longer auto-renewed, so the
          // member re-signs up through the wizard. Active memberships are
          // auto-invoiced — the only action offered is opting out.
          onRenew={() => startPurchase(membership.type, false)}
          onCancelAutoRenew={
            isOwner ? () => handleCancelAutoRenew(membership.id) : null
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

      {membership && isActive && membership.type === "family" && (
        <FamilySection
          membershipId={membership.id}
          memberIds={membership.members.map((m) => m.id)}
          ownerId={membership.ownerUserId.id}
          isOwner={isOwner}
          currentUserId={userDoc?.id ?? ""}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pending invites addressed to the signed-in user (join from here)   */
/* ------------------------------------------------------------------ */

interface PendingInviteCard {
  membershipId: string
  inviteId: string
  inviterName: string
}

function PendingInvitesBanner() {
  const functions = useFunctions()
  const navigate = useNavigate()
  const { userDoc } = useAuth()
  const email = userDoc?.email ?? null

  const [cards, setCards] = React.useState<PendingInviteCard[]>([])

  React.useEffect(() => {
    if (!email) {
      setCards([])
      return
    }
    let cancelled = false
    const fn = rpcCallable<unknown, { invites: PendingInviteCard[] }>(
      functions,
      "membershipCall",
      "listMyFamilyInvites",
    )
    fn({})
      .then(({ data }) => {
        if (!cancelled) setCards(data.invites)
      })
      .catch(() => {
        if (!cancelled) setCards([])
      })
    return () => {
      cancelled = true
    }
  }, [functions, email])

  const acceptMutation = useAsyncMutation({
    context: "checkout.acceptFamilyInvite",
    successMessage: "Du gehörst jetzt zur Familie!",
    errorMessage: "Einladung konnte nicht angenommen werden",
  })
  const rejectMutation = useAsyncMutation({
    context: "checkout.rejectFamilyInvite",
    successMessage: "Einladung abgelehnt",
    errorMessage: "Einladung konnte nicht abgelehnt werden",
  })

  const drop = (inviteId: string) =>
    setCards((prev) => prev.filter((c) => c.inviteId !== inviteId))

  const handleAccept = (card: PendingInviteCard) =>
    acceptMutation.mutate(async () => {
      const fn = rpcCallable(functions, "membershipCall", "acceptFamilyInvite")
      await fn({ membershipId: card.membershipId, inviteId: card.inviteId })
      drop(card.inviteId)
      navigate({ to: "/account/membership" as never } as never)
    })
  const handleReject = (card: PendingInviteCard) =>
    rejectMutation.mutate(async () => {
      const fn = rpcCallable(functions, "membershipCall", "rejectFamilyInvite")
      await fn({ membershipId: card.membershipId, inviteId: card.inviteId })
      drop(card.inviteId)
    })

  if (cards.length === 0) return null
  const busy = acceptMutation.loading || rejectMutation.loading

  return (
    <>
      {cards.map((card) => (
        <Card key={card.inviteId} className="border-cog-teal">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Badge variant="default">
                <Users />
                Einladung
              </Badge>
            </div>
            <p className="mt-3 text-sm">
              Du wurdest zur <strong>Familie {card.inviterName}</strong>{" "}
              eingeladen. Tritt bei, um vergünstigte Preise zu erhalten.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => handleAccept(card)} disabled={busy}>
                <Check />
                Beitreten
              </Button>
              <Button
                variant="outline"
                onClick={() => handleReject(card)}
                disabled={busy}
              >
                <X />
                Ablehnen
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
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
  autoRenew,
  loading,
  onRenew,
  onCancelAutoRenew,
}: {
  type: "single" | "family"
  status: "active" | "expired" | "cancelled"
  validUntil: string
  isOwner: boolean
  autoRenew: boolean
  loading: boolean
  onRenew: () => void
  onCancelAutoRenew: (() => void) | null
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
              <>Erneuere, um wieder Mitglieder-Preise zu erhalten.</>
            )}
            {status === "cancelled" && (
              <>Reaktivierung nur durch Admin möglich.</>
            )}
          </p>
          {/* Expired memberships are no longer auto-renewed (#323) — the
              member re-signs up through the wizard. */}
          {status === "expired" && (
            <Button onClick={onRenew} disabled={loading}>
              <RefreshCw />
              Erneuern
            </Button>
          )}
        </div>

        {/* Active memberships auto-renew (#323): show the status and let the
            owner opt out of the next invoice. */}
        {status === "active" && (
          <div className="mt-5 border-t pt-4">
            {autoRenew ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Deine Mitgliedschaft wird automatisch verlängert. Rund 30 Tage
                  vor Ablauf erhältst du eine Rechnung per E-Mail.
                </p>
                {onCancelAutoRenew && (
                  <Button
                    variant="outline"
                    onClick={onCancelAutoRenew}
                    disabled={loading}
                  >
                    Automatische Verlängerung beenden
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Die automatische Verlängerung ist beendet. Deine Mitgliedschaft
                bleibt bis zum {validUntil} aktiv und läuft danach aus.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Pending — membership SKU sits in the user's open checkout          */
/* ------------------------------------------------------------------ */

function PendingMembershipCheckout({
  type,
}: {
  type: "single" | "family"
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {type === "family" ? <Users /> : <User />}
            {type === "family" ? "Familie" : "Einzel"}
          </Badge>
          <Badge variant="outline">Im Checkout</Badge>
        </div>
        <h2 className="font-heading text-xl font-bold">
          Mitgliedschaft im Checkout
        </h2>
        <p className="text-sm text-muted-foreground">
          Du hast bereits eine{" "}
          {type === "family" ? "Familien-" : "Einzel-"}mitgliedschaft im
          offenen Checkout. Schliesse den Checkout ab, um sie zu aktivieren.
        </p>
        <Button asChild>
          <Link to="/checkout">
            Zur Zahlung
            <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* No-membership purchase entry                                       */
/* ------------------------------------------------------------------ */

/** Statuten PDF hosted on the Werkstatt-Wädenswil Squarespace site. */
const STATUTEN_URL =
  "https://static1.squarespace.com/static/64671911eefe89405a1c141c/t/64c0d17d08167476c68a6a2d/1690358141557/230609+OWW+Statuten+aktualisiert.pdf"

const SINGLE_BENEFITS: string[] = [
  "Vergünstigungen bei der Maschinennutzung",
  "Ein Stimmrecht an der jährlichen Mitgliederversammlung",
]

const FAMILY_BENEFITS: string[] = [
  "Vergünstigungen bei der Maschinennutzung",
  "Ein Stimmrecht an der jährlichen Mitgliederversammlung",
  "Gültig für alle im selben Haushalt lebende Personen",
]

export function NoMembership({
  onPurchase,
  loading,
  priceByType,
}: {
  onPurchase: (type: "single" | "family", renewExisting: boolean) => void
  loading: boolean
  priceByType: Record<"single" | "family", string>
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div>
          <h2 className="font-heading text-xl font-bold">Mitglied werden</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mit deiner Mitgliedschaft unterstützt du den Verein «Offene
            Werkstatt Wädenswil» und hilfst mit, dass die Werkstätten und
            Ateliers auch in Zukunft für alle offen bleiben.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BuyCard
            eyebrow={
              <>
                <User className="inline size-3 align-[-2px]" /> Für dich
              </>
            }
            title="Einzel-Mitgliedschaft"
            benefits={SINGLE_BENEFITS}
            price={priceByType.single}
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
            title="Familien-Mitgliedschaft"
            benefits={FAMILY_BENEFITS}
            price={priceByType.family}
            onClick={() => onPurchase("family", false)}
            disabled={loading}
          />
        </div>

        <p className="text-sm text-muted-foreground">
          <a
            href={STATUTEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-cog-teal-dark underline underline-offset-2 hover:no-underline"
            data-testid="membership-statuten-link"
          >
            Statuten des Vereins (PDF)
          </a>
        </p>

        <Note kind="info">
          Die Mitgliedschaft wird über den Self-Checkout abgerechnet (Twint oder
          E-Banking).
        </Note>
      </CardContent>
    </Card>
  )
}

function BuyCard({
  eyebrow,
  title,
  benefits,
  price,
  onClick,
  disabled,
}: {
  eyebrow: React.ReactNode
  title: string
  benefits: string[]
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
      <ul className="space-y-1.5 text-sm leading-snug text-muted-foreground">
        {benefits.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className="mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-cog-teal-light text-cog-teal-dark">
              <Check className="size-2.5" />
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <span className="mt-auto flex items-end justify-between pt-1">
        <span className="text-lg font-bold tabular-nums text-foreground">
          CHF {price}
          <span className="ml-0.5 text-xs font-medium text-muted-foreground">
            /Jahr
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-cog-teal-dark">
          Zum Self-Checkout →
        </span>
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Inline family section (only for owner of an active family)         */
/* ------------------------------------------------------------------ */

/** Login-less managed members are only ever adults or kids — never firma. */
type ManagedMemberType = "erwachsen" | "kind"

type AddMode = "closed" | "chooser" | "invite" | "no-login"

function FamilySection({
  membershipId,
  memberIds,
  ownerId,
  isOwner,
  currentUserId,
}: {
  membershipId: string
  memberIds: string[]
  ownerId: string
  isOwner: boolean
  currentUserId: string
}) {
  const db = useDb()
  const functions = useFunctions()

  // Only the owner/admin may list the invites sub-collection (Firestore
  // rules) — a non-owner member skips the subscription entirely.
  const { data: invites } = useCollection(
    isOwner ? membershipInvitesCollection(db, membershipId) : null,
  )
  const pending = invites.filter((i) => i.status === "pending")

  const [addMode, setAddMode] = React.useState<AddMode>("closed")
  const [inviteEmail, setInviteEmail] = React.useState("")
  const [noLoginFirst, setNoLoginFirst] = React.useState("")
  const [noLoginLast, setNoLoginLast] = React.useState("")
  const [noLoginType, setNoLoginType] =
    React.useState<ManagedMemberType>("kind")

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
  const createMemberMutation = useAsyncMutation({
    context: "checkout.createManagedMember",
    successMessage: "Mitglied hinzugefügt",
    errorMessage: "Mitglied konnte nicht hinzugefügt werden",
  })

  const totalCount = memberIds.length
  const pendingCount = pending.length

  const resetAdd = () => {
    setAddMode("closed")
    setInviteEmail("")
    setNoLoginFirst("")
    setNoLoginLast("")
    setNoLoginType("kind")
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.includes("@")) return
    await inviteMutation.mutate(async () => {
      const fn = rpcCallable<
        { membershipId: string; email: string },
        { inviteId: string }
      >(functions, "membershipCall", "inviteFamilyMember")
      await fn({ membershipId, email: inviteEmail.trim() })
      resetAdd()
    })
  }

  const handleRevoke = async (inviteId: string) => {
    await revokeMutation.mutate(async () => {
      const fn = rpcCallable(functions, "membershipCall", "revokeFamilyInvite")
      await fn({ membershipId, inviteId })
    })
  }

  const leaveMutation = useAsyncMutation({
    context: "checkout.leaveFamily",
    successMessage: "Du hast die Familie verlassen",
    errorMessage: "Verlassen fehlgeschlagen",
  })

  // Confirmation is handled by <ConfirmDialog>; `pendingRemoval` holds the
  // target. `self` distinguishes the owner removing a member from a member
  // leaving (different copy + success message).
  const [pendingRemoval, setPendingRemoval] = React.useState<{
    uid: string
    self: boolean
  } | null>(null)

  const confirmRemoval = async () => {
    if (!pendingRemoval) return
    const { uid, self } = pendingRemoval
    const mutation = self ? leaveMutation : removeMutation
    try {
      await mutation.mutate(async () => {
        const fn = rpcCallable(functions, "membershipCall", "removeFamilyMember")
        await fn({ membershipId, userId: uid })
      })
    } catch {
      // Hook already toasted + reported; keep the dialog state cleared below.
    }
    setPendingRemoval(null)
  }

  const handleCreateNoLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!noLoginFirst.trim() || !noLoginLast.trim()) return
    await createMemberMutation.mutate(async () => {
      const fn = rpcCallable(functions, "membershipCall", "createManagedMember")
      await fn({
        membershipId,
        firstName: noLoginFirst.trim(),
        lastName: noLoginLast.trim(),
        userType: noLoginType,
      })
      resetAdd()
    })
  }

  return (
    <>
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-xl font-bold">Familie</h2>
          <span className="text-sm text-muted-foreground">
            {totalCount} {totalCount === 1 ? "Person" : "Personen"}
            {pendingCount > 0 && ` · ${pendingCount} ausstehend`}
          </span>
        </div>

        <ul className="mt-2">
          {memberIds.map((uid) => (
            <MemberRow
              key={uid}
              userId={uid}
              isOwner={uid === ownerId}
              // Owner/admin removes any non-owner member; a non-owner member can
              // only leave themselves ("Familie verlassen").
              onRemove={
                isOwner
                  ? uid === ownerId
                    ? null
                    : () => setPendingRemoval({ uid, self: false })
                  : uid === currentUserId
                    ? () => setPendingRemoval({ uid, self: true })
                    : null
              }
              removeLabel={!isOwner && uid === currentUserId ? "Verlassen" : "Entfernen"}
              noLoginLabel={
                isOwner
                  ? "Kein Login · von dir verwaltet"
                  : "Kein Login · von der Familie verwaltet"
              }
              removing={removeMutation.loading || leaveMutation.loading}
            />
          ))}
          {pending.map((inv) => (
            <li
              key={inv.id}
              className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3 border-b py-3 opacity-90 last:border-0"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Send className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {inv.email}
                </div>
                <div className="text-xs text-muted-foreground">
                  Eingeladen {formatRelativeTime(inv.invitedAt)} · läuft in 30
                  Tagen ab
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

        {isOwner && (
        <div className="mt-4 border-t pt-4">
          {addMode === "closed" && (
            <button
              type="button"
              onClick={() => setAddMode("chooser")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-cog-teal/60 py-3 text-sm font-semibold text-cog-teal-dark transition hover:border-cog-teal hover:bg-cog-teal-light"
            >
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-cog-teal text-white">
                <Plus className="size-4" />
              </span>
              Mitglied hinzufügen
            </button>
          )}

          {addMode === "chooser" && (
            <div>
              <h3 className="font-heading text-lg font-bold">
                Wie möchtest du hinzufügen?
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <AddChoiceCard
                  icon={<Send className="size-5" />}
                  iconClassName="bg-cog-teal text-white"
                  title="Konto einladen"
                  description="Person mit eigenem Login. Bestehendes Konto wird verknüpft, oder ein neues per E-Mail erstellt."
                  onClick={() => setAddMode("invite")}
                />
                <AddChoiceCard
                  icon={<User className="size-5" />}
                  iconClassName="bg-muted-foreground text-white"
                  title="Ohne Login"
                  description="Konto ohne eigenes Login, von dir verwaltet — für Kinder oder Erwachsene ohne E-Mail."
                  onClick={() => setAddMode("no-login")}
                />
              </div>
              <button
                type="button"
                onClick={resetAdd}
                className="mt-4 text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                Abbrechen
              </button>
            </div>
          )}

          {addMode === "invite" && (
            <div>
              <BackLink onClick={() => setAddMode("chooser")} />
              <h3 className="mt-3 font-heading text-lg font-bold">
                Konto einladen
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Die Person erhält einen Link per E-Mail und meldet sich mit
                eigenem Konto an.
              </p>
              <form onSubmit={handleInvite} className="mt-4 flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="invite-email" className="text-sm font-bold">
                    E-Mail-Adresse
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    autoFocus
                    placeholder="name@beispiel.ch"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!inviteEmail.includes("@") || inviteMutation.loading}
                >
                  <Send />
                  Einladen
                </Button>
              </form>
            </div>
          )}

          {addMode === "no-login" && (
            <form onSubmit={handleCreateNoLogin}>
              <BackLink onClick={() => setAddMode("chooser")} />
              <h3 className="mt-3 font-heading text-lg font-bold">
                Mitglied ohne Login
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Du verwaltest dieses Konto. Eine E-Mail kannst du später
                nachtragen, um ein Login zu aktivieren.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="nologin-first" className="text-sm font-bold">
                    Vorname <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="nologin-first"
                    autoFocus
                    placeholder="Mia"
                    value={noLoginFirst}
                    onChange={(e) => setNoLoginFirst(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="nologin-last" className="text-sm font-bold">
                    Nachname <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="nologin-last"
                    placeholder="Müller"
                    value={noLoginLast}
                    onChange={(e) => setNoLoginLast(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label className="text-sm font-bold">Typ</Label>
                <div className="flex flex-wrap gap-6 pt-2">
                  {(["erwachsen", "kind"] as ManagedMemberType[]).map(
                    (value) => (
                      <label
                        key={value}
                        className="inline-flex cursor-pointer select-none items-center gap-2 text-sm"
                      >
                        <span
                          className={cn(
                            "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors",
                            noLoginType === value
                              ? "border-cog-teal bg-cog-teal"
                              : "border-[#c1c1c1] bg-background",
                          )}
                        >
                          {noLoginType === value && (
                            <span className="h-2 w-2 rounded-full bg-white" />
                          )}
                        </span>
                        <input
                          type="radio"
                          name="nologin-type"
                          value={value}
                          checked={noLoginType === value}
                          onChange={() => setNoLoginType(value)}
                          className="sr-only"
                        />
                        {USER_TYPE_LABELS[value]}
                      </label>
                    ),
                  )}
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    !noLoginFirst.trim() ||
                    !noLoginLast.trim() ||
                    createMemberMutation.loading
                  }
                >
                  <Plus />
                  Hinzufügen
                </Button>
              </div>
            </form>
          )}
        </div>
        )}
      </CardContent>
    </Card>
    <ConfirmDialog
      open={pendingRemoval !== null}
      onOpenChange={(open) => {
        if (!open) setPendingRemoval(null)
      }}
      title={pendingRemoval?.self ? "Familie verlassen?" : "Mitglied entfernen?"}
      description={
        pendingRemoval?.self
          ? "Du verlierst den vergünstigten Mitglieder-Tarif. Um wieder beizutreten, musst du erneut von der Familie eingeladen werden."
          : "Diese Person wird aus der Familie entfernt und verliert den Mitglieder-Tarif."
      }
      confirmLabel={pendingRemoval?.self ? "Verlassen" : "Entfernen"}
      destructive
      confirmDisabled={removeMutation.loading || leaveMutation.loading}
      onConfirm={confirmRemoval}
    />
    </>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      Zurück
    </button>
  )
}

function AddChoiceCard({
  icon,
  iconClassName,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  iconClassName: string
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-xl border bg-card p-5 text-left transition hover:border-cog-teal hover:bg-cog-teal-light"
    >
      <span
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-lg",
          iconClassName,
        )}
      >
        {icon}
      </span>
      <span className="font-heading text-lg font-bold leading-tight">
        {title}
      </span>
      <span className="text-sm leading-snug text-muted-foreground">
        {description}
      </span>
      <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-cog-teal-dark">
        Weiter <ArrowRight className="size-4" />
      </span>
    </button>
  )
}

function MemberRow({
  userId,
  isOwner,
  onRemove,
  removeLabel = "Entfernen",
  noLoginLabel,
  removing,
}: {
  userId: string
  isOwner: boolean
  onRemove: (() => void) | null
  removeLabel?: string
  /** Subtitle for a login-less member (managed phrasing differs by viewer). */
  noLoginLabel: string
  removing: boolean
}) {
  const db = useDb()
  // Family-roster join rule allows reading co-members' user docs.
  const { data: user } = useDocument(userRef(db, userId))
  const name = formatFullName(user ?? {}, userId)
  // ADR-0029: a login email (not userType) is what makes a member an
  // account-holder who checks in on their own. Login-less members are the
  // ones the owner manages and can roster.
  const hasAccount = !!user?.email?.trim()
  const isChild = user?.userType === "kind"

  return (
    <li className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3 border-b py-3 last:border-0">
      <Avatar name={name} />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="text-xs text-muted-foreground">
          {hasAccount ? user?.email : noLoginLabel}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {isOwner && (
          <Badge variant="gold">
            <Crown />
            Inhaber:in
          </Badge>
        )}
        {!isOwner && hasAccount && (
          <Badge variant="outline">
            <LogIn />
            Login
          </Badge>
        )}
        {!isOwner && !hasAccount && isChild && (
          <Badge variant="secondary">Kind</Badge>
        )}
      </div>
      <div>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={removing}>
            <X />
            {removeLabel}
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
