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

import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { useFunctions } from "@modules/lib/firebase-context"
import { prewarm } from "@modules/lib/rpc"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { INPUT_OK, ErrorBadge } from "@modules/components/profile-form"
import { GoogleSignInButton } from "./google-signin-button"
import { requestCodeWithThrottle } from "./login-code-request"
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

// Historic export location — the helper moved to login-code-request.ts so
// non-page hosts (embedded check-in sign-in) can share it without pulling
// in the page component.
export { isResendThrottleError } from "./login-code-request"

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
    signOut,
    pendingGoogleLink,
  } = useAuth()
  const navigate = useNavigate()
  const targetPath = redirectTo || defaultRedirect
  const functions = useFunctions()

  // The e-mail submit hits authCall (checkAccountExists / requestLoginCode);
  // warm it while the user is still typing (ADR-0037).
  useEffect(() => {
    prewarm(functions, "authCall")
  }, [functions])

  const [stage, setStage] = useState<Stage>(
    signupFlag ? { kind: "signup", via: "link" } : { kind: "email" },
  )
  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [signinCode, setSigninCode] = useState("")
  const [signupValue, setSignupValue] = useState<SignupFieldsValue>(EMPTY_SIGNUP_VALUE)
  const [signupErrors, setSignupErrors] = useState<SignupFieldsErrors>({})
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [showLinkHint, setShowLinkHint] = useState(false)
  // Suppresses the redirect effect while handleSignOutAndRestart is mid-flight:
  // the local stage is already reset to "email" but `user` is still non-null
  // until onAuthStateChanged fires, so the effect would re-pin the sign-up stage.
  const signingOutRef = useRef(false)

  // Route the signed-in principal. A completed account redirects to the target;
  // a signed-in-but-incomplete principal (Google-new / magic-link-new / legacy)
  // is dropped into the inline sign-up form. Anonymous (eager-anon checkout)
  // and tag sessions are left alone.
  useEffect(() => {
    if (signingOutRef.current) return
    if (loading || !user || user.isAnonymous || sessionKind === "tag") return
    if (userDocLoading) return

    if (!signupEnabled) {
      // Admin: completeness gating is the authenticated layout's job.
      navigate({ to: pendingGoogleLink ? "/link-account" : targetPath })
      return
    }
    if (userDoc) {
      // A users doc exists — completed OR incomplete (imported / admin-created
      // / legacy straggler). Route into the app rather than the doc-less
      // inline sign-up: the member gate / wizard then shows the
      // welcome-onboarding dialog with their imported data prefilled for the
      // incomplete case. Without this, an imported member logging in via
      // /login would get a blank inline sign-up form instead of the welcome
      // flow the check-in path gives.
      navigate({ to: pendingGoogleLink ? "/link-account" : targetPath })
      return
    }
    // Signed in with NO users doc → a fresh principal (Google-new /
    // magic-link-new). Finish sign-up inline. Keep an already-chosen sign-up
    // stage (e.g. Google prefill) instead of resetting — EXCEPT the via:"code"
    // stage: the user is signed in now (e.g. they clicked the magic link in
    // another tab), so the inline code is consumed/moot and the form must
    // submit via completeSignedInSignup instead.
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

  const handleGoogleNewAccount = ({
    firstName,
    lastName,
  }: {
    firstName: string
    lastName: string
  }) => {
    if (!signupEnabled) return
    setSignupValue({ ...EMPTY_SIGNUP_VALUE, firstName, lastName })
    setSignupErrors({})
    setStage({ kind: "signup", via: "google" })
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Own validation (form is noValidate): the native bubble is styled by
    // the browser and speaks the browser's language, not the product's.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Bitte gib eine gültige E-Mail-Adresse ein.")
      return
    }
    setEmailError(null)
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
      // `hasProfile` = a `users` doc exists (with or without accepted terms).
      // That covers both completed accounts and imported/admin-created members
      // who still need onboarding — both sign IN with a code; only a truly new
      // e-mail (no doc) gets the sign-up form. (`exists` ⇒ `hasProfile`, so it
      // adds nothing here.) Post-login, the member-gate shows the onboarding
      // dialog with their data prefilled.
      const { hasProfile } = await checkAccountExists(email)
      // The 60s per-email throttle is not a dead end: a prior unconsumed code
      // stays valid (only a successful re-request invalidates it). Typical
      // trigger is "Ändern" → same e-mail again — advance to the stage and
      // tell the user the earlier code still works.
      const { throttled } = await requestCodeWithThrottle(requestLoginEmail, email)
      if (hasProfile) {
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
    setEmailError(null)
    setSignupErrors({})
  }

  // Re-send the code without leaving the stage — an expired code (5 min TTL)
  // must not be a dead end. The server only throttles while a code is still
  // active, so an expired/consumed code gets a fresh one immediately.
  const handleResendCode = async () => {
    if (sending) return
    setSending(true)
    try {
      const { throttled } = await requestCodeWithThrottle(requestLoginEmail, email)
      setSigninCode("")
      setCodeError(null)
      setSignupValue((v) => ({ ...v, code: "" }))
      setSignupErrors((e) => ({ ...e, code: undefined }))
      if (throttled) {
        toast.info("Wir haben dir bereits eine E-Mail geschickt — der Code ist noch gültig.")
      } else {
        toast.success("Neuer Code gesendet!")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehler"
      toast.error(`Fehler: ${message}`)
    } finally {
      setSending(false)
    }
  }

  // Escape for a half-signed-in session (Google / magic link without a
  // completed profile): the redirect effect pins /login to the sign-up
  // stage for such a principal, so without this the user can neither
  // switch accounts nor log out.
  const handleSignOutAndRestart = async () => {
    signingOutRef.current = true
    try {
      await signOut()
    } catch (err) {
      console.error("signOut failed", err)
    } finally {
      signingOutRef.current = false
    }
    setEmail("")
    setEmailError(null)
    setSignupValue(EMPTY_SIGNUP_VALUE)
    setSignupErrors({})
    setStage({ kind: "email" })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const googleButton = (
    <GoogleSignInButton
      onNewAccount={handleGoogleNewAccount}
      onLinkHint={() => setShowLinkHint(true)}
    />
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
      noValidate
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
          onChange={(e) => {
            setEmail(e.target.value)
            if (emailError) setEmailError(null)
          }}
          aria-invalid={!!emailError}
          className={
            emailError
              ? "h-10 border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30"
              : "h-10"
          }
          data-testid="login-email-input"
        />
        {emailError && <ErrorBadge message={emailError} />}
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

  // Same shell as the rest of the product: a slim header bar with the logo
  // (mirrors the wizard layout), then a top-aligned 440px column with a
  // left-aligned slab heading. Only the column itself is centered.
  return (
    <div className="min-h-screen bg-background">
      <header className="w-full bg-background border-b border-border">
        {/* Header inner width matches the 440px content column so the logo
            sits flush with the heading below. */}
        <div className="w-full max-w-[440px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <img
            src="/logo_oww.png"
            alt="Offene Werkstatt Wädenswil"
            className="h-12 shrink-0"
          />
          {subtitle && (
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </header>

      <div className="max-w-[440px] mx-auto px-6 pt-10 pb-16">
        <h1 className="font-heading font-bold text-[28px] leading-tight mb-2">
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
            <div className="flex flex-col gap-5" data-testid="login-code-stage">
              {/* Same field pattern as the sign-up form: read-only e-mail
                  with an Ändern escape, then the code with a plain helper
                  line explaining where it came from. */}
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="login-code-email" className="text-sm font-bold">
                    E-Mail
                  </label>
                  <button
                    type="button"
                    onClick={handleUseDifferentEmail}
                    className="text-sm font-medium text-cog-teal-dark underline hover:no-underline"
                  >
                    Ändern
                  </button>
                </div>
                <input
                  id="login-code-email"
                  data-testid="login-code-email"
                  value={email}
                  readOnly
                  tabIndex={-1}
                  className={`${INPUT_OK} bg-muted/50 text-muted-foreground focus:border-[#ccc] focus:ring-0`}
                />
              </div>

              <form onSubmit={handleSigninCodeSubmit} className="flex flex-col gap-1">
                <label htmlFor="login-code" className="text-sm font-bold">
                  Code aus der E-Mail
                  <span className="text-destructive ml-0.5">*</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Wir haben dir einen 6-stelligen Code an diese Adresse
                  geschickt — gib ihn ein oder klicke auf den Link in der
                  E-Mail.{" "}
                  <button
                    type="button"
                    onClick={handleResendCode}
                    data-testid="login-resend-code"
                    className="font-medium text-cog-teal-dark underline hover:no-underline"
                  >
                    Code erneut senden
                  </button>
                </p>
                <Input
                  id="login-code"
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
                  className="w-full h-11 mt-3 text-[15px] bg-cog-teal hover:bg-cog-teal-dark text-white font-semibold"
                  disabled={verifying || signinCode.length !== 6}
                  data-testid="login-code-submit"
                >
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Anmelden
                </Button>
              </form>
            </div>
          )}

          {stage.kind === "signup" && (
            <div className="flex flex-col gap-5" data-testid="login-signup-stage">
              <form onSubmit={handleSignupSubmit} className="flex flex-col gap-5">
                <SignupFields
                  value={signupValue}
                  errors={signupErrors}
                  onChange={(patch) => setSignupValue((v) => ({ ...v, ...patch }))}
                  showCode={stage.via === "code"}
                  email={email || user?.email || undefined}
                  emailAction={
                    stage.via === "code"
                      ? { label: "Ändern", onClick: handleUseDifferentEmail }
                      : { label: "Abmelden", onClick: handleSignOutAndRestart }
                  }
                  onResendCode={stage.via === "code" ? handleResendCode : undefined}
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
