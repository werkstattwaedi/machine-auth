// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Shared Galaxus-style combined sign-in / sign-up page used by both web apps.
//
// Flow (checkout, signupEnabled): the user enters their e-mail; we ask the
// server whether a *completed* account exists, then branch:
//   - exists  → show only the 6-digit code (sign-in)
//   - new     → show the inline sign-up form (name + member type + terms,
//               with the code entered inline where Galaxus puts the password;
//               firma also fills its address)
// Google verifies the e-mail up front, so a new Google account skips straight
// to the sign-up form (name prefilled, no code). A redeemed magic link for a
// new account lands here already signed-in, in the same sign-up form.
//
// Admin (signupEnabled = false) keeps the plain e-mail → code flow: admin
// accounts are admin-created, so there is no existence check and no sign-up.

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Loader2, Mail } from "lucide-react"
import { useAuth, isProfileComplete } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { GoogleIcon } from "@modules/components/icons/google"
import {
  SignupFields,
  EMPTY_SIGNUP_VALUE,
  validateSignupFields,
  signupProfileFrom,
  type SignupFieldsValue,
  type SignupFieldsErrors,
} from "./signup-fields"

export interface LoginPageProps {
  /** Where to send the user after a successful sign-in / sign-up. */
  defaultRedirect: string
  /** When true, run the combined sign-in/sign-up flow (checkout). */
  signupEnabled?: boolean
  /** Optional small caption under the logo (e.g. "Administration"). */
  subtitle?: string
  /** Visual order of the Google vs e-mail buttons. */
  googleButtonPosition?: "top" | "bottom"
  /** Optional ?redirect= search-param value (set by each app's route). */
  redirect?: string
  /** When set (magic-link new account), open directly in the sign-up stage. */
  signup?: boolean
}

type Stage =
  | { kind: "email" }
  | { kind: "signin-code" }
  | { kind: "signup"; via: "code" | "google" | "link" }

/** The 60s per-email resend throttle (`resource-exhausted`). The previously
 *  sent code is still valid in that case, so callers advance instead of
 *  dead-ending on an error toast. */
function isResendThrottleError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "functions/resource-exhausted"
  )
}

export function LoginPage({
  defaultRedirect,
  signupEnabled = false,
  subtitle,
  googleButtonPosition = "bottom",
  redirect: redirectTo,
  signup: signupFlag,
}: LoginPageProps) {
  const {
    user,
    userDoc,
    userDocLoading,
    loading,
    sessionKind,
    checkAccountExists,
    requestLoginEmail,
    verifyLoginCode,
    verifyLoginCodeAndCreateProfile,
    completeSignedInSignup,
    signInWithGoogle,
    pendingGoogleLink,
  } = useAuth()
  const navigate = useNavigate()
  const targetPath = redirectTo || defaultRedirect

  const [stage, setStage] = useState<Stage>(
    signupFlag ? { kind: "signup", via: "link" } : { kind: "email" },
  )
  const [email, setEmail] = useState("")
  const [signinCode, setSigninCode] = useState("")
  const [signupValue, setSignupValue] = useState<SignupFieldsValue>(EMPTY_SIGNUP_VALUE)
  const [signupErrors, setSignupErrors] = useState<SignupFieldsErrors>({})
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [showLinkHint, setShowLinkHint] = useState(false)

  // Route the signed-in principal. A completed account redirects to the target;
  // a signed-in-but-incomplete principal (Google-new / magic-link-new / legacy)
  // is dropped into the inline sign-up form. Anonymous (eager-anon checkout)
  // and tag sessions are left alone.
  useEffect(() => {
    if (loading || !user || user.isAnonymous || sessionKind === "tag") return
    if (userDocLoading) return

    if (!signupEnabled) {
      // Admin: completeness gating is the authenticated layout's job.
      navigate({ to: pendingGoogleLink ? "/link-account" : targetPath })
      return
    }
    if (userDoc && isProfileComplete(userDoc)) {
      navigate({ to: pendingGoogleLink ? "/link-account" : targetPath })
      return
    }
    // Signed in without a completed profile → finish sign-up inline. Keep an
    // already-chosen sign-up stage (e.g. Google prefill) instead of resetting —
    // EXCEPT the via:"code" stage: the user is signed in now (e.g. they clicked
    // the magic link in another tab), so the inline code is consumed/moot and
    // the form must submit via completeSignedInSignup instead.
    setStage((prev) =>
      prev.kind === "signup" && prev.via !== "code"
        ? prev
        : { kind: "signup", via: "link" },
    )
  }, [
    user,
    userDoc,
    userDocLoading,
    loading,
    sessionKind,
    signupEnabled,
    pendingGoogleLink,
    navigate,
    targetPath,
  ])

  const handleGoogleSignIn = async () => {
    setSigningInWithGoogle(true)
    try {
      const { isNewAccount, firstName, lastName } = await signInWithGoogle()
      if (isNewAccount && signupEnabled) {
        setSignupValue({ ...EMPTY_SIGNUP_VALUE, firstName, lastName })
        setSignupErrors({})
        setStage({ kind: "signup", via: "google" })
      }
      // Existing account → the redirect effect handles navigation.
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? (err as { code: string }).code
          : undefined
      if (code === "auth/account-exists-with-different-credential") {
        setShowLinkHint(true)
        toast.info("Bitte zuerst per E-Mail-Code anmelden")
      } else if (code === "auth/popup-closed-by-user") {
        // User closed the popup — no error needed.
      } else {
        const message = err instanceof Error ? err.message : "Fehler"
        toast.error(`Anmeldung fehlgeschlagen: ${message}`)
      }
    } finally {
      setSigningInWithGoogle(false)
    }
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSending(true)
    try {
      if (!signupEnabled) {
        // Admin: no existence check, just email a code.
        await requestLoginEmail(email)
        setStage({ kind: "signin-code" })
        setSigninCode("")
        setCodeError(null)
        toast.success("E-Mail gesendet!")
        return
      }
      const { exists } = await checkAccountExists(email)
      // The 60s per-email throttle is not a dead end: a prior unconsumed code
      // stays valid (only a successful re-request invalidates it). Typical
      // trigger is "Ändern" → same e-mail again — advance to the stage and
      // tell the user the earlier code still works.
      let throttled = false
      try {
        await requestLoginEmail(email)
      } catch (err: unknown) {
        if (isResendThrottleError(err)) throttled = true
        else throw err
      }
      if (exists) {
        setStage({ kind: "signin-code" })
        setSigninCode("")
        setCodeError(null)
      } else {
        setSignupValue(EMPTY_SIGNUP_VALUE)
        setSignupErrors({})
        setStage({ kind: "signup", via: "code" })
      }
      if (throttled) {
        toast.info("Wir haben dir bereits eine E-Mail geschickt — der Code ist noch gültig.")
      } else {
        toast.success("E-Mail gesendet!")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehler"
      toast.error(`Fehler: ${message}`)
    } finally {
      setSending(false)
    }
  }

  const handleSigninCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (signinCode.length !== 6) return
    setVerifying(true)
    setCodeError(null)
    try {
      await verifyLoginCode(email, signinCode)
      toast.success("Erfolgreich angemeldet")
      // Redirect handled by the effect once the user state updates.
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Code falsch."
      setCodeError(message)
      setSigninCode("")
    } finally {
      setVerifying(false)
    }
  }

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (stage.kind !== "signup") return
    const via = stage.via
    const errs = validateSignupFields(signupValue, { requireCode: via === "code" })
    setSignupErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSubmitting(true)
    try {
      const profile = signupProfileFrom(signupValue)
      if (via === "code") {
        await verifyLoginCodeAndCreateProfile(email, signupValue.code, profile)
      } else {
        await completeSignedInSignup(profile)
      }
      toast.success("Konto erstellt")
      // Redirect handled by the effect once the user doc updates.
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehler"
      if (via === "code") {
        setSignupErrors({ code: message })
      } else {
        toast.error(`Fehler: ${message}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleUseDifferentEmail = () => {
    setStage({ kind: "email" })
    setSigninCode("")
    setCodeError(null)
    setSignupErrors({})
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const googleButton = (
    <Button
      onClick={handleGoogleSignIn}
      className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold"
      disabled={signingInWithGoogle}
    >
      {signingInWithGoogle ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : (
        <GoogleIcon className="h-4 w-4 mr-2" />
      )}
      Mit Google anmelden
    </Button>
  )

  const divider = (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-background px-2 text-muted-foreground">oder</span>
      </div>
    </div>
  )

  const emailForm = (
    <form onSubmit={handleEmailSubmit} className="space-y-4" data-testid="login-email-stage">
      <div className="space-y-1.5">
        <label
          htmlFor="login-email"
          className="block text-sm font-bold text-left"
        >
          E-Mail-Adresse
        </label>
        <Input
          id="login-email"
          type="email"
          placeholder="deine@email.ch"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          data-testid="login-email-input"
        />
      </div>
      <Button
        type="submit"
        className="w-full bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
        disabled={sending}
        data-testid="login-email-submit"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Weiter
      </Button>
    </form>
  )

  const heading =
    stage.kind === "signup"
      ? "Konto erstellen"
      : stage.kind === "signin-code"
        ? "Anmelden"
        : signupEnabled
          ? "Anmelden oder Konto erstellen"
          : "Anmelden"

  // One line of context under the heading so the user knows why they're
  // looking at this stage (a typo'd e-mail on the sign-up branch would
  // otherwise be invisible — the e-mail is shown with an Ändern escape).
  const headingHint =
    stage.kind === "signup"
      ? stage.via === "code"
        ? "Für diese E-Mail-Adresse gibt es noch kein Konto."
        : "Noch ein paar Angaben, dann ist dein Konto bereit."
      : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div
        className={
          stage.kind === "signup"
            ? "w-full max-w-md space-y-8"
            : "w-full max-w-sm space-y-8"
        }
      >
        <div className="flex flex-col items-center gap-4">
          <img src="/logo_oww.png" alt="Offene Werkstatt Wädenswil" className="h-14" />
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="border border-border rounded p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-center">{heading}</h2>
            {headingHint && (
              <p className="text-sm text-muted-foreground text-center">
                {headingHint}
              </p>
            )}
          </div>

          {stage.kind === "email" && (
            <>
              {showLinkHint && (
                <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
                  Ein Konto mit dieser E-Mail existiert bereits. Melde dich per E-Mail-Code an,
                  um dein Google-Konto zu verknüpfen.
                </div>
              )}
              {googleButtonPosition === "top" ? (
                <>
                  {googleButton}
                  {divider}
                  {emailForm}
                </>
              ) : (
                <>
                  {emailForm}
                  {divider}
                  {googleButton}
                </>
              )}
            </>
          )}

          {stage.kind === "signin-code" && (
            <div className="space-y-4" data-testid="login-code-stage">
              <div className="text-center space-y-2">
                <Mail className="h-10 w-10 mx-auto text-cog-teal" />
                <p className="text-sm">
                  Wir haben eine E-Mail an <strong>{email}</strong> gesendet.
                </p>
                <p className="text-sm text-muted-foreground">
                  Gib den 6-stelligen Code ein oder klicke auf den Link in der E-Mail.
                </p>
              </div>

              <form onSubmit={handleSigninCodeSubmit} className="space-y-3">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={signinCode}
                  onChange={(e) => setSigninCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-xl tracking-widest"
                  data-testid="login-code-input"
                  aria-label="6-stelliger Code"
                />
                {codeError && (
                  <p className="text-sm text-red-600" data-testid="login-code-error">
                    {codeError}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
                  disabled={verifying || signinCode.length !== 6}
                  data-testid="login-code-submit"
                >
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Anmelden
                </Button>
              </form>

              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className="w-full text-sm text-muted-foreground hover:text-foreground underline"
              >
                Andere E-Mail-Adresse verwenden
              </button>
            </div>
          )}

          {stage.kind === "signup" && (
            <div className="space-y-4" data-testid="login-signup-stage">
              {(email || user?.email) && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <Mail className="h-4 w-4 text-cog-teal shrink-0" />
                    <span className="font-medium truncate">
                      {email || user?.email}
                    </span>
                  </span>
                  {stage.via === "code" && (
                    <button
                      type="button"
                      onClick={handleUseDifferentEmail}
                      className="text-cog-teal hover:underline shrink-0"
                    >
                      Ändern
                    </button>
                  )}
                </div>
              )}

              <form onSubmit={handleSignupSubmit} className="space-y-5">
                <SignupFields
                  value={signupValue}
                  errors={signupErrors}
                  onChange={(patch) => setSignupValue((v) => ({ ...v, ...patch }))}
                  showCode={stage.via === "code"}
                />
                <Button
                  type="submit"
                  className="w-full bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
                  disabled={submitting}
                  data-testid="signup-submit"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Konto erstellen
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
