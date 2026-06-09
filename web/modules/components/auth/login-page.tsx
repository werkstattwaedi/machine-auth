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
      className="w-full h-11 text-[15px] bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold shadow-xs"
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
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex-1 border-t border-border" />
      oder
      <span className="flex-1 border-t border-border" />
    </div>
  )

  const emailForm = (
    <form
      onSubmit={handleEmailSubmit}
      className="flex flex-col gap-4"
      data-testid="login-email-stage"
    >
      <div>
        <label
          htmlFor="login-email"
          className="block text-sm font-bold mb-1 text-left"
        >
          E-Mail
          <span className="text-destructive ml-0.5">*</span>
        </label>
        <Input
          id="login-email"
          type="email"
          placeholder="deine@email.ch"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="h-10"
          data-testid="login-email-input"
        />
      </div>
      <Button
        type="submit"
        className="w-full h-11 text-[15px] bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
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
      : stage.kind === "email" && signupEnabled
        ? "Melde dich mit deiner E-Mail-Adresse an oder erstelle ein neues Konto."
        : null

  // Layout follows the design-system LoginScreen: a top-aligned 440px column
  // (no card box, no vertical centering), logo on top, slab heading, muted
  // intro line. Text is left-aligned like every other page heading in the
  // product; only the column itself is centered.
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[440px] mx-auto px-6 pt-10 pb-16">
        <img
          src="/logo_oww.png"
          alt="Offene Werkstatt Wädenswil"
          className="h-[72px] sm:h-[93px] mb-2"
        />
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}

        <h1 className="font-heading font-bold text-[28px] leading-tight mt-6 mb-2">
          {heading}
        </h1>
        {headingHint && (
          <p className="text-sm text-muted-foreground">
            {headingHint}
          </p>
        )}

        <div className="w-full mt-8">
          {stage.kind === "email" && (
            <div className="flex flex-col gap-4">
              {showLinkHint && (
                <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
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
            </div>
          )}

          {stage.kind === "signin-code" && (
            <div className="flex flex-col gap-4" data-testid="login-code-stage">
              <div className="flex items-start gap-3 rounded-lg bg-cog-teal-light p-4 text-sm text-cog-teal-dark">
                <Mail className="h-5 w-5 shrink-0 mt-0.5" />
                <span>
                  Code an <strong className="break-all">{email}</strong> gesendet.
                  Gib den 6-stelligen Code ein oder klicke auf den Link in der
                  E-Mail.
                </span>
              </div>

              <form onSubmit={handleSigninCodeSubmit} className="flex flex-col gap-3">
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
                  className="h-11 text-center !text-xl tracking-[0.3em]"
                  data-testid="login-code-input"
                  aria-label="6-stelliger Code"
                />
                {codeError && (
                  <p className="text-sm text-destructive" data-testid="login-code-error">
                    {codeError}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full h-11 text-[15px] bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
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
                className="self-start text-sm font-medium text-cog-teal-dark underline hover:no-underline"
              >
                Andere E-Mail-Adresse verwenden
              </button>
            </div>
          )}

          {stage.kind === "signup" && (
            <div className="flex flex-col gap-5" data-testid="login-signup-stage">
              {stage.via === "code" ? (
                <div className="flex items-start gap-3 rounded-lg bg-cog-teal-light p-4 text-sm text-cog-teal-dark">
                  <Mail className="h-5 w-5 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    Code an <strong className="break-all">{email}</strong> gesendet.
                    Prüfe dein Postfach.{" "}
                    <button
                      type="button"
                      onClick={handleUseDifferentEmail}
                      className="font-medium underline hover:no-underline"
                    >
                      Ändern
                    </button>
                  </span>
                </div>
              ) : (
                (email || user?.email) && (
                  <p className="text-sm text-muted-foreground">
                    Angemeldet als{" "}
                    <strong className="text-foreground break-all">
                      {email || user?.email}
                    </strong>
                  </p>
                )
              )}

              <form onSubmit={handleSignupSubmit} className="flex flex-col gap-5">
                <SignupFields
                  value={signupValue}
                  errors={signupErrors}
                  onChange={(patch) => setSignupValue((v) => ({ ...v, ...patch }))}
                  showCode={stage.via === "code"}
                />
                <Button
                  type="submit"
                  className="w-full h-11 text-[15px] bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
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
