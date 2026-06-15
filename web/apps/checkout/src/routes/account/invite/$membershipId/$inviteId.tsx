// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Family-invite acceptance landing — reachable WITHOUT an account.
 *
 * Route shape: /account/invite/$membershipId/$inviteId (public — NOT under the
 * `_authenticated` layout, so a brand-new invitee can land here directly from
 * the email link). Invite details are fetched via the `getFamilyInviteInfo`
 * callable because Firestore rules forbid an unauthenticated read of the invite
 * doc.
 *
 * Three branches once the invite is `pending`:
 *  1. Signed in (real account) with the invited email → Accept / Reject.
 *  2. Not signed in, but a completed account exists for the email → send to
 *     normal login (the link must not pseudo-login an existing account).
 *  3. Not signed in, no account yet → a minimal sign-up (name + terms, no code:
 *     the link already proves email control). Creates the account, accepts the
 *     invite, and signs in via a custom token.
 */

import * as React from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { signInWithCustomToken } from "firebase/auth"
import { useAuth } from "@modules/lib/auth"
import { useFirebaseAuth, useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { PageLoading } from "@modules/components/page-loading"
import { Card, CardContent } from "@modules/components/ui/card"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { Checkbox } from "@modules/components/ui/checkbox"

export const Route = createFileRoute("/account/invite/$membershipId/$inviteId")({
  component: InviteAcceptPage,
})

type FamilyInviteStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "revoked"
  | "expired"
  | "not_found"

interface InviteInfo {
  status: FamilyInviteStatus
  email: string | null
  inviterName: string
  accountExists: boolean
}

function InviteAcceptPage() {
  const { membershipId, inviteId } = Route.useParams()
  const functions = useFunctions()
  const firebaseAuth = useFirebaseAuth()
  const { user, userDoc, sessionKind, loading, userDocLoading } = useAuth()
  const navigate = useNavigate()

  const [info, setInfo] = React.useState<InviteInfo | null>(null)
  const [infoLoading, setInfoLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    const fn = rpcCallable<
      { membershipId: string; inviteId: string },
      InviteInfo
    >(functions, "membershipCall", "getFamilyInviteInfo")
    fn({ membershipId, inviteId })
      .then(({ data }) => {
        if (!cancelled) setInfo(data)
      })
      .catch(() => {
        if (!cancelled)
          setInfo({
            status: "not_found",
            email: null,
            inviterName: "Jemand",
            accountExists: false,
          })
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [functions, membershipId, inviteId])

  const isReal = sessionKind === "real" && !!user

  if (loading || userDocLoading || infoLoading || !info) {
    return <PageLoading />
  }

  return (
    <Shell title="Familieneinladung">
      {info.status === "not_found" ? (
        <Terminal>Einladung nicht gefunden oder bereits abgelaufen.</Terminal>
      ) : info.status === "expired" ? (
        <Terminal>Diese Einladung ist abgelaufen.</Terminal>
      ) : info.status !== "pending" ? (
        <Terminal>
          Diese Einladung wurde bereits{" "}
          {info.status === "accepted"
            ? "angenommen"
            : info.status === "rejected"
              ? "abgelehnt"
              : "zurückgezogen"}
          .
        </Terminal>
      ) : isReal ? (
        <SignedInAccept
          membershipId={membershipId}
          inviteId={inviteId}
          inviteEmail={info.email}
          userEmail={userDoc?.email ?? null}
          inviterName={info.inviterName}
          onDone={() =>
            navigate({ to: "/account/membership" as never } as never)
          }
        />
      ) : info.accountExists ? (
        <ExistingAccountLogin
          inviterName={info.inviterName}
          email={info.email}
          onLogin={() =>
            navigate({
              to: "/login",
              search: {
                redirect: `/account/invite/${membershipId}/${inviteId}`,
              },
            })
          }
        />
      ) : (
        <NewAccountSignup
          membershipId={membershipId}
          inviteId={inviteId}
          email={info.email}
          inviterName={info.inviterName}
          onSignedIn={async (customToken) => {
            await signInWithCustomToken(firebaseAuth, customToken)
            navigate({ to: "/account/membership" as never } as never)
          }}
        />
      )}
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* Branch: signed-in real account — accept or reject                  */
/* ------------------------------------------------------------------ */

function SignedInAccept({
  membershipId,
  inviteId,
  inviteEmail,
  userEmail,
  inviterName,
  onDone,
}: {
  membershipId: string
  inviteId: string
  inviteEmail: string | null
  userEmail: string | null
  inviterName: string
  onDone: () => void
}) {
  const functions = useFunctions()
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

  const wrongEmail =
    !!userEmail &&
    !!inviteEmail &&
    userEmail.toLowerCase() !== inviteEmail.toLowerCase()
  const busy = acceptMutation.loading || rejectMutation.loading

  const handleAccept = () =>
    acceptMutation.mutate(async () => {
      const fn = rpcCallable(functions, "membershipCall", "acceptFamilyInvite")
      await fn({ membershipId, inviteId })
      onDone()
    })
  const handleReject = () =>
    rejectMutation.mutate(async () => {
      const fn = rpcCallable(functions, "membershipCall", "rejectFamilyInvite")
      await fn({ membershipId, inviteId })
      onDone()
    })

  return (
    <div className="space-y-3">
      <p>
        Du wurdest zur <strong>Familie {inviterName}</strong> eingeladen{" "}
        {inviteEmail && (
          <>
            (<span className="font-mono">{inviteEmail}</span>)
          </>
        )}
        .
      </p>
      {wrongEmail && (
        <p className="text-sm text-destructive">
          Diese Einladung ist für eine andere E-Mail-Adresse als dein Login.
          Bitte mit der eingeladenen Adresse anmelden.
        </p>
      )}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleAccept} disabled={wrongEmail || busy}>
          Annehmen
        </Button>
        <Button variant="outline" onClick={handleReject} disabled={busy}>
          Ablehnen
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Branch: account exists — go log in                                 */
/* ------------------------------------------------------------------ */

function ExistingAccountLogin({
  inviterName,
  email,
  onLogin,
}: {
  inviterName: string
  email: string | null
  onLogin: () => void
}) {
  return (
    <div className="space-y-3">
      <p>
        Du wurdest zur <strong>Familie {inviterName}</strong> eingeladen.
      </p>
      <p className="text-sm text-muted-foreground">
        Für {email ? <span className="font-mono">{email}</span> : "diese Adresse"}{" "}
        existiert bereits ein Konto. Melde dich an, um die Einladung anzunehmen.
      </p>
      <Button onClick={onLogin}>Anmelden &amp; annehmen</Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Branch: no account — minimal sign-up (no code)                     */
/* ------------------------------------------------------------------ */

function NewAccountSignup({
  membershipId,
  inviteId,
  email,
  inviterName,
  onSignedIn,
}: {
  membershipId: string
  inviteId: string
  email: string | null
  inviterName: string
  onSignedIn: (customToken: string) => Promise<void>
}) {
  const functions = useFunctions()
  const [firstName, setFirstName] = React.useState("")
  const [lastName, setLastName] = React.useState("")
  const [termsAccepted, setTermsAccepted] = React.useState(false)

  const joinMutation = useAsyncMutation({
    context: "checkout.acceptFamilyInviteNewAccount",
    successMessage: "Willkommen in der Familie!",
    errorMessage: "Konto konnte nicht erstellt werden",
  })

  const canSubmit =
    !!firstName.trim() && !!lastName.trim() && termsAccepted && !joinMutation.loading

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    joinMutation.mutate(async () => {
      const fn = rpcCallable<
        {
          membershipId: string
          inviteId: string
          firstName: string
          lastName: string
          termsAccepted: boolean
        },
        { customToken: string }
      >(functions, "membershipCall", "acceptFamilyInviteNewAccount")
      const { data } = await fn({
        membershipId,
        inviteId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        termsAccepted,
      })
      await onSignedIn(data.customToken)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p>
        Du wurdest zur <strong>Familie {inviterName}</strong> eingeladen
        {email && (
          <>
            {" "}
            (<span className="font-mono">{email}</span>)
          </>
        )}
        . Erstelle dein Konto, um beizutreten.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="invite-first" className="text-sm font-bold">
            Vorname <span className="text-destructive">*</span>
          </Label>
          <Input
            id="invite-first"
            autoFocus
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="invite-last" className="text-sm font-bold">
            Nachname <span className="text-destructive">*</span>
          </Label>
          <Input
            id="invite-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id="invite-terms"
          className="bg-white"
          checked={termsAccepted}
          onCheckedChange={(checked) => setTermsAccepted(checked === true)}
        />
        <label htmlFor="invite-terms" className="text-sm leading-snug">
          Ich akzeptiere die{" "}
          <a
            href="https://werkstattwaedi.ch/nutzungsbestimmungen"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-cog-teal underline"
          >
            Nutzungsbestimmungen
          </a>
        </label>
      </div>
      <Button type="submit" disabled={!canSubmit}>
        Konto erstellen &amp; beitreten
      </Button>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                     */
/* ------------------------------------------------------------------ */

function Shell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col items-center bg-background">
      <header className="w-full px-4 sm:px-6 pt-6 pb-2">
        <div className="w-full max-w-lg mx-auto">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-14"
          />
        </div>
      </header>
      <main className="w-full max-w-lg px-4 sm:px-6 py-4">
        <h1 className="mb-4 font-heading text-2xl font-bold">{title}</h1>
        <Card>
          <CardContent className="pt-6">{children}</CardContent>
        </Card>
      </main>
    </div>
  )
}

function Terminal({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
