// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Family-invite acceptance landing — reachable WITHOUT an account, styled to
 * match the auth (login/signup) design.
 *
 * Route shape: /account/invite/$membershipId/$inviteId (public — NOT under the
 * `_authenticated` layout). Invite details come from the `getFamilyInviteInfo`
 * callable because Firestore rules forbid an unauthenticated read of the invite.
 *
 * Routing by auth state:
 *  - Signed in (real), email matches invite → redirect to /account/membership
 *    (the pending-invite banner handles accept/reject).
 *  - Signed in, email mismatch → redirect to /account/membership?invite=… (the
 *    membership page shows a wrong-account notice).
 *  - Logged out, account exists for the invited email → inline login (code +
 *    Google), then accept.
 *  - Logged out, no account → inline sign-up (shared SignupFields, no code —
 *    the link proves email control), then accept via custom token.
 */

import * as React from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { signInWithCustomToken } from "firebase/auth"
import { Loader2 } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { useFirebaseAuth, useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import {
  SignupFields,
  EMPTY_SIGNUP_VALUE,
  validateSignupFields,
  signupProfileFrom,
  type SignupFieldsValue,
  type SignupFieldsErrors,
} from "@modules/components/auth"
import { INPUT_OK } from "@modules/components/profile-form"
import { GoogleIcon } from "@modules/components/icons/google"
import { Button } from "@modules/components/ui/button"
import { Label } from "@modules/components/ui/label"
import { PageLoading } from "@modules/components/page-loading"

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
  inviterEmail: string | null
  accountExists: boolean
}

function sameEmail(a: string | null | undefined, b: string | null | undefined) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

function InviteAcceptPage() {
  const { membershipId, inviteId } = Route.useParams()
  const functions = useFunctions()
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
            inviterEmail: null,
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
  const ready = !loading && !userDocLoading && !infoLoading && !!info

  // Signed-in users never accept here — they're routed to the membership page.
  React.useEffect(() => {
    if (!ready || !info || !isReal || info.status !== "pending") return
    if (sameEmail(userDoc?.email, info.email)) {
      navigate({ to: "/account/membership" })
    } else {
      navigate({
        to: "/account/membership",
        search: { invite: `${membershipId}~${inviteId}` },
      })
    }
  }, [ready, info, isReal, userDoc?.email, navigate, membershipId, inviteId])

  if (!ready || !info) return <PageLoading />

  // Terminal states (also covers a signed-in user whose invite isn't pending).
  if (info.status !== "pending") {
    return (
      <InviteShell title="Familieneinladung">
        <p className="text-sm text-muted-foreground">
          {info.status === "not_found"
            ? "Einladung nicht gefunden oder bereits abgelaufen."
            : info.status === "expired"
              ? "Diese Einladung ist abgelaufen."
              : info.status === "accepted"
                ? "Diese Einladung wurde bereits angenommen."
                : info.status === "rejected"
                  ? "Diese Einladung wurde bereits abgelehnt."
                  : "Diese Einladung wurde zurückgezogen."}
        </p>
      </InviteShell>
    )
  }

  if (isReal) return <PageLoading /> // redirecting to /account/membership

  return info.accountExists ? (
    <InviteLogin
      membershipId={membershipId}
      inviteId={inviteId}
      info={info}
    />
  ) : (
    <InviteSignup
      membershipId={membershipId}
      inviteId={inviteId}
      info={info}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Logged out, no account → inline sign-up (shared SignupFields)       */
/* ------------------------------------------------------------------ */

function InviteSignup({
  membershipId,
  inviteId,
  info,
}: {
  membershipId: string
  inviteId: string
  info: InviteInfo
}) {
  const functions = useFunctions()
  const firebaseAuth = useFirebaseAuth()
  const navigate = useNavigate()
  const [value, setValue] = React.useState<SignupFieldsValue>(EMPTY_SIGNUP_VALUE)
  const [errors, setErrors] = React.useState<SignupFieldsErrors>({})

  const join = useAsyncMutation({
    context: "checkout.acceptFamilyInviteNewAccount",
    successMessage: "Willkommen in der Familie!",
    errorMessage: "Konto konnte nicht erstellt werden",
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validateSignupFields(value, { requireCode: false })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    const profile = signupProfileFrom(value)
    join.mutate(async () => {
      const fn = rpcCallable<
        Record<string, unknown>,
        { customToken: string }
      >(functions, "membershipCall", "acceptFamilyInviteNewAccount")
      const { data } = await fn({
        membershipId,
        inviteId,
        firstName: profile.firstName,
        lastName: profile.lastName,
        userType: profile.userType,
        termsAccepted: true,
        billingAddress: profile.billingAddress ?? null,
      })
      await signInWithCustomToken(firebaseAuth, data.customToken)
      navigate({ to: "/account/membership" })
    })
  }

  return (
    <InviteShell
      title="Konto erstellen"
      hint={
        <>
          Du wurdest von <strong>{info.inviterName}</strong>
          {info.inviterEmail ? ` (${info.inviterEmail})` : ""} zur
          Familienmitgliedschaft eingeladen. Damit profitierst du von
          Vergünstigungen bei der Maschinenbenutzung. Erstelle dein Konto, um
          beizutreten.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <SignupFields
          value={value}
          errors={errors}
          onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
          showCode={false}
          email={info.email ?? undefined}
        />
        <Button
          type="submit"
          className="w-full h-11 text-[15px] bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
          disabled={join.loading}
        >
          {join.loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Konto erstellen &amp; beitreten
        </Button>
      </form>
    </InviteShell>
  )
}

/* ------------------------------------------------------------------ */
/* Logged out, account exists → inline login (code + Google)           */
/* ------------------------------------------------------------------ */

function InviteLogin({
  membershipId,
  inviteId,
  info,
}: {
  membershipId: string
  inviteId: string
  info: InviteInfo
}) {
  const functions = useFunctions()
  const { requestLoginEmail, verifyLoginCode, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const email = info.email ?? ""
  const [code, setCode] = React.useState("")
  const sentRef = React.useRef(false)

  // Send the code once on mount. Best-effort — the user can resend.
  React.useEffect(() => {
    if (sentRef.current || !email) return
    sentRef.current = true
    requestLoginEmail(email).catch(() => undefined)
  }, [email, requestLoginEmail])

  const accept = async () => {
    const fn = rpcCallable(functions, "membershipCall", "acceptFamilyInvite")
    await fn({ membershipId, inviteId })
    navigate({ to: "/account/membership" })
  }

  const codeLogin = useAsyncMutation({
    context: "checkout.inviteCodeLogin",
    errorMessage: "Anmeldung fehlgeschlagen",
  })
  const googleLogin = useAsyncMutation({
    context: "checkout.inviteGoogleLogin",
    errorMessage: "Google-Anmeldung fehlgeschlagen",
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return
    codeLogin.mutate(async () => {
      await verifyLoginCode(email, code)
      await accept()
    })
  }
  const handleGoogle = () =>
    googleLogin.mutate(async () => {
      await signInWithGoogle()
      await accept()
    })

  const busy = codeLogin.loading || googleLogin.loading

  return (
    <InviteShell
      title="Anmelden"
      hint={
        <>
          Du wurdest von <strong>{info.inviterName}</strong> zur
          Familienmitgliedschaft eingeladen. Melde dich an, um beizutreten.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-email" className="text-sm font-bold">
            E-Mail
          </Label>
          <input
            id="invite-email"
            value={email}
            readOnly
            tabIndex={-1}
            className={`${INPUT_OK} bg-muted/50 text-muted-foreground focus:border-[#ccc] focus:ring-0`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-login-code" className="text-sm font-bold">
            Bestätigungscode <span className="text-destructive -ml-1">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Wir haben dir einen 6-stelligen Code an diese Adresse geschickt.{" "}
            <button
              type="button"
              onClick={() => requestLoginEmail(email).catch(() => undefined)}
              className="font-medium text-cog-teal-dark underline hover:no-underline"
            >
              Code erneut senden
            </button>
          </p>
          <input
            id="invite-login-code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${INPUT_OK} text-center !text-xl tracking-[0.3em]`}
            aria-label="6-stelliger Code"
          />
        </div>

        <Button
          type="submit"
          className="w-full h-11 text-[15px] bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
          disabled={code.length !== 6 || busy}
        >
          {codeLogin.loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Anmelden &amp; annehmen
        </Button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex-1 border-t border-border" />
          oder
          <span className="flex-1 border-t border-border" />
        </div>

        <Button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full h-11 text-[15px] bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold shadow-xs"
        >
          {googleLogin.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon className="h-4 w-4" />
          )}
          Mit Google anmelden
        </Button>
      </form>
    </InviteShell>
  )
}

/* ------------------------------------------------------------------ */
/* Shared auth-styled shell (mirrors LoginPage's header + 440 column)  */
/* ------------------------------------------------------------------ */

function InviteShell({
  title,
  hint,
  children,
}: {
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="w-full bg-background border-b border-border">
        <div className="w-full max-w-[440px] mx-auto px-6 py-3 flex items-center gap-4">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-12 shrink-0"
          />
        </div>
      </header>
      <div className="max-w-[440px] mx-auto px-6 pt-10 pb-16">
        <h1 className="font-heading font-bold text-[28px] leading-tight mb-2">
          {title}
        </h1>
        {hint && (
          <p className="text-sm text-muted-foreground leading-snug">{hint}</p>
        )}
        <div className="w-full mt-8">{children}</div>
      </div>
    </div>
  )
}
