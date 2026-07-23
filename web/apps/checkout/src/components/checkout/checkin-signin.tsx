// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Embedded account sign-in on /checkin (design handoff "Kiosk sign-in flow
 * redesign", surfaces 3a/3b + session refinements). Renders the account side
 * of the check-in switcher. Each surface offers exactly two ways in, as a
 * two-column split on wide viewports (identifier field | vertical "oder" |
 * second method) that stacks behind a horizontal divider on phones:
 *   - kiosk: the second column is the NFC badge affordance (passed as
 *     children). No Google.
 *   - personal device: the second column is the Google button (with
 *     "Mit Anmelde-Code" / "Mit Google" eyebrows on desktop). No badge.
 * The field carries a hint instead of a label; the member-discount pitch
 * lives on the guest tab's gold note (step-checkin.tsx).
 *
 * Code entry and sign-up happen in modal dialogs (not inline stages like
 * /login): the switcher and field stay hidden behind the scrim, and
 * "Abbrechen" returns to the idle state with the identifier cleared.
 *
 * Two session flavors behind one UI (see ADR-0022):
 *   - kiosk: the verified code mints the same lightweight synthetic `actsAs`
 *     session as a badge tap (verifyLoginCodeKiosk + establishKioskSession).
 *     No sign-up (new users register on their own device), no Google.
 *   - own device: the regular persistent login (verifyLoginCode). An unknown
 *     e-mail offers the existing sign-up form in a dialog; Google sign-in is
 *     available and a Google-new account completes sign-up in the same
 *     dialog (completeSignedInSignup — the wizard's complete-profile
 *     redirect can't handle a doc-less principal).
 *
 * The component never handles "success" itself: a established session flips
 * `isAnonymous` in the wizard, which unmounts this block and renders the
 * signed-in "Deine Angaben" view instead.
 */

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowRight, Loader2 } from "lucide-react"
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as firebaseSignOut,
  type ConfirmationResult,
} from "firebase/auth"
import { useAuth } from "@modules/lib/auth"
import { useFunctions, useFirebaseAuth } from "@modules/lib/firebase-context"
import { parseSwissPhone } from "@modules/lib/phone"
import { resolveBridgeBearer } from "@modules/lib/use-bridge"
import { rpcCallable, prewarm } from "@modules/lib/rpc"
import { establishKioskSession, type TokenUser } from "@modules/lib/token-auth"
import {
  GoogleSignInButton,
  requestCodeWithThrottle,
  EMPTY_SIGNUP_VALUE,
  validateSignupFields,
  signupProfileFrom,
  type SignupFieldsValue,
  type SignupFieldsErrors,
} from "@modules/components/auth"
import { AddressFields } from "@modules/components/profile-form"
import { Checkbox } from "@modules/components/ui/checkbox"
import { USER_TYPE_LABELS, type UserType } from "@modules/lib/pricing"
import { cn } from "@modules/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Button } from "@modules/components/ui/button"
import { CodeEntryDialog, messageFromError } from "./code-entry-dialog"

/** Channel the typed identifier routes to. `sms` needs the smsEnabled flag. */
export type LoginChannel = "email" | "sms"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Loose phone shape (design handoff): starts with + or a digit, then
 *  digits/whitespace/separators, at least 4 digits overall. */
const PHONE_RE = /^[+0-9][0-9\s/().-]*$/

/**
 * Decide which channel a typed identifier belongs to. Email requires a full
 * plausible address (not just an "@") so the inline submit arrow doubles as
 * the validation gate — there is no separate error state for a half-typed
 * identifier. Exported for unit tests.
 */
export function detectChannel(
  value: string,
  smsEnabled: boolean,
): LoginChannel | null {
  const v = value.trim()
  if (EMAIL_RE.test(v)) return "email"
  if (smsEnabled && PHONE_RE.test(v) && v.replace(/\D/g, "").length >= 4) {
    return "sms"
  }
  return null
}

/** Uppercase column header of the desktop two-column split (`.k-split-h`).
 *  Hidden on phones — the stacked 3b layout carries no headers. */
function ColumnEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-3 hidden text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground sm:block">
      {children}
    </span>
  )
}

interface VerifyLoginCodeKioskResponse {
  customToken: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  activeMembership?: boolean
}

type Stage =
  | { kind: "idle" }
  | { kind: "code"; identifier: string; channel: LoginChannel }
  | { kind: "signup"; via: "code" | "google"; identifier: string }

/**
 * SMS login rollout flag (ADR-0031). Sourced from the operations config via
 * scripts/generate-env.ts (`web.smsLoginEnabled`); absent/false keeps the
 * check-in field e-mail-only. Production additionally needs the phone
 * sign-in provider enabled on the Firebase project (deployment checklist).
 */
const SMS_LOGIN_ENABLED = import.meta.env.VITE_SMS_LOGIN_ENABLED === "true"

interface ExchangeKioskSessionResponse {
  customToken: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  activeMembership?: boolean
}

export interface CheckinSigninProps {
  kiosk: boolean
  /** Step 2 (SMS login codes): enables phone-number detection. Defaults to
   *  the VITE_SMS_LOGIN_ENABLED env flag; overridable for tests. */
  smsEnabled?: boolean
  /** Rendered below the "oder" divider on the kiosk — the NFC affordance. */
  children?: React.ReactNode
}

export function CheckinSignin({
  kiosk,
  smsEnabled = SMS_LOGIN_ENABLED,
  children,
}: CheckinSigninProps) {
  const {
    user,
    checkAccountExists,
    requestLoginEmail,
    verifyLoginCode,
    verifyLoginCodeAndCreateProfile,
    completeSignedInSignup,
    signOut,
  } = useAuth()
  const functions = useFunctions()
  const auth = useFirebaseAuth()

  // Sign-in submits hit authCall (checkPhoneAccountExists / checkAccountExists
  // / kiosk session exchange); warm it while the visitor types (ADR-0037).
  useEffect(() => {
    prewarm(functions, "authCall")
  }, [functions])

  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  const [identifier, setIdentifier] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [showLinkHint, setShowLinkHint] = useState(false)
  const [busy, setBusy] = useState(false)

  // Firebase phone-auth handles (SMS channel). The ConfirmationResult from
  // signInWithPhoneNumber is what confirms the typed code; the invisible
  // reCAPTCHA verifier is single-use, so it's recreated per send inside a
  // stable container div.
  const confirmationRef = useRef<ConfirmationResult | null>(null)
  const recaptchaHostRef = useRef<HTMLDivElement | null>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)
  useEffect(
    () => () => {
      verifierRef.current?.clear()
      verifierRef.current = null
    },
    [],
  )

  const channel = detectChannel(identifier, smsEnabled)

  const reset = () => {
    setStage({ kind: "idle" })
    setIdentifier("")
    setFieldError(null)
    setBusy(false)
    confirmationRef.current = null
  }

  /** Fresh invisible reCAPTCHA for each SMS send (a verifier is consumed by
   *  one signInWithPhoneNumber call). In the emulator the challenge is
   *  bypassed via appVerificationDisabledForTesting (firebase.ts). */
  const newRecaptchaVerifier = (): RecaptchaVerifier => {
    verifierRef.current?.clear()
    const host = recaptchaHostRef.current
    if (!host) throw new Error("reCAPTCHA host not mounted")
    const slot = document.createElement("div")
    host.replaceChildren(slot)
    const verifier = new RecaptchaVerifier(auth, slot, { size: "invisible" })
    verifierRef.current = verifier
    return verifier
  }

  /** Look up the (verified, auth-linked) phone account and send the SMS.
   *  Returns the E.164 identifier, or null after surfacing a field error. */
  const sendSmsCode = async (id: string): Promise<string | null> => {
    const parsed = await parseSwissPhone(id)
    if (!parsed.ok) {
      setFieldError("Bitte gib eine gültige Handynummer ein.")
      return null
    }
    const checkPhone = rpcCallable<
      { phone: string },
      { exists: boolean; hasAuthUser: boolean }
    >(functions, "authCall", "checkPhoneAccountExists")
    const { data } = await checkPhone({ phone: parsed.e164 })
    if (!data.exists) {
      // SMS sign-in only works for numbers verified on the profile —
      // there is no phone-based sign-up on either surface.
      setFieldError(
        "Für diese Handynummer ist kein Konto hinterlegt. Melde dich mit deiner E-Mail an und bestätige die Nummer in deinem Profil.",
      )
      return null
    }
    confirmationRef.current = await signInWithPhoneNumber(
      auth,
      parsed.e164,
      newRecaptchaVerifier(),
    )
    return parsed.e164
  }

  const submitIdentifier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!channel || busy) return
    const id = identifier.trim()
    setBusy(true)
    setFieldError(null)
    try {
      if (channel === "sms") {
        const e164 = await sendSmsCode(id)
        if (e164) setStage({ kind: "code", identifier: e164, channel: "sms" })
        return
      }
      const { exists, hasProfile } = await checkAccountExists(id)
      if (kiosk) {
        // No sign-up at the shared terminal (ADR-0022). The kiosk verify
        // (verifyLoginCodeKiosk) also requires accepted terms, so an
        // unclaimed member (hasProfile but !exists) can't check in here
        // anyway — must finish onboarding on their own device first. Gate on
        // the stricter `exists` so they get an immediate field error instead
        // of a failure after the code roundtrip.
        if (!exists) {
          setFieldError(
            "Für diese E-Mail existiert noch kein Konto. Bitte registriere dich zuerst auf deinem eigenen Gerät.",
          )
          return
        }
        await requestCodeWithThrottle(requestLoginEmail, id)
        setStage({ kind: "code", identifier: id, channel: "email" })
        return
      }
      // Own device: `hasProfile` = a `users` doc exists (completed OR an
      // imported/admin-created member who still needs onboarding). Both sign
      // IN with a code; only a truly new e-mail (no doc) gets the sign-up
      // form. (`exists` ⇒ `hasProfile`, so it adds nothing here.) After login
      // the wizard shows the welcome-onboarding dialog as an overlay with
      // their name/address prefilled — a fresh sign-up here couldn't prefill
      // (not authenticated yet) and would overwrite their imported profile.
      // The sign-up form needs the code too, so request it for both branches.
      const { throttled } = await requestCodeWithThrottle(requestLoginEmail, id)
      if (throttled) {
        toast.info(
          "Wir haben dir bereits eine E-Mail geschickt — der Code ist noch gültig.",
        )
      }
      setStage(
        hasProfile
          ? { kind: "code", identifier: id, channel: "email" }
          : { kind: "signup", via: "code", identifier: id },
      )
    } catch (err) {
      setFieldError(
        messageFromError(err, "Anmeldung fehlgeschlagen. Bitte versuche es erneut."),
      )
    } finally {
      setBusy(false)
    }
  }

  /** SMS verify: confirm() signs the browser in as the REAL user. On the
   *  kiosk that session is immediately exchanged for the ephemeral actsAs
   *  session (ADR-0022) — and torn down again if the exchange fails. */
  const verifySmsCode = async (code: string) => {
    const confirmation = confirmationRef.current
    if (!confirmation) {
      throw new Error("Kein Code aktiv — bitte fordere einen neuen Code an.")
    }
    try {
      await confirmation.confirm(code)
    } catch (err) {
      const errCode = (err as { code?: string } | null)?.code
      if (errCode === "auth/invalid-verification-code") {
        throw new Error("Code falsch.")
      }
      if (errCode === "auth/code-expired") {
        throw new Error("Der Code ist abgelaufen. Bitte fordere einen neuen an.")
      }
      throw err
    }
    if (!kiosk) return // Own device: the persistent phone session IS the login.
    try {
      const bearer = await resolveBridgeBearer()
      const exchange = rpcCallable<
        { bearer?: string },
        ExchangeKioskSessionResponse
      >(functions, "authCall", "exchangeKioskSession")
      const { data } = await exchange({ bearer: bearer ?? undefined })
      const tokenUser: TokenUser = {
        tokenId: null,
        userId: data.userId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        userType: data.userType,
        activeMembership: data.activeMembership,
      }
      await establishKioskSession(auth, data.customToken, tokenUser)
    } catch (err) {
      // Never leave the real phone session behind on the shared terminal.
      await firebaseSignOut(auth).catch(() => {})
      throw err
    }
  }

  const verifyKioskCode = async (id: string, code: string) => {
    const bearer = await resolveBridgeBearer()
    const verify = rpcCallable<
      { email: string; code: string; bearer?: string },
      VerifyLoginCodeKioskResponse
    >(functions, "authCall", "verifyLoginCodeKiosk")
    const { data } = await verify({ email: id, code, bearer: bearer ?? undefined })
    const tokenUser: TokenUser = {
      tokenId: null,
      userId: data.userId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      userType: data.userType,
      activeMembership: data.activeMembership,
    }
    await establishKioskSession(auth, data.customToken, tokenUser)
    // The identified session flips `isAnonymous` in the wizard, which
    // unmounts this component (dialog included) — nothing left to do.
  }

  const handleGoogleNewAccount = ({
    firstName,
    lastName,
  }: {
    firstName: string
    lastName: string
  }) => {
    setStage({ kind: "signup", via: "google", identifier: "" })
    setSignupPrefill({ firstName, lastName })
  }

  // Google-new prefill is handed to the signup dialog via state so the
  // dialog owns its form lifecycle (reset on open).
  const [signupPrefill, setSignupPrefill] = useState<{
    firstName: string
    lastName: string
  } | null>(null)

  const identifierForm = (
    <form onSubmit={submitIdentifier} noValidate>
      <div className="relative">
        <input
          id="checkin-identifier"
          type={smsEnabled ? "text" : "email"}
          inputMode={smsEnabled ? "text" : "email"}
          autoComplete="off"
          aria-label={smsEnabled ? "E-Mail oder Handynummer" : "E-Mail"}
          placeholder={
            smsEnabled ? "name@beispiel.ch · +41 79 …" : "name@beispiel.ch"
          }
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value)
            if (fieldError) setFieldError(null)
          }}
          disabled={busy}
          data-testid="checkin-identifier"
          className="h-[42px] w-full rounded-md border border-[#ccc] bg-white pl-3 pr-[54px] text-base md:text-[15px] shadow-xs outline-none transition-[color,box-shadow] focus:border-cog-teal focus:ring-[3px] focus:ring-cog-teal/30 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          aria-label="Code senden"
          disabled={!channel || busy}
          data-testid="checkin-identifier-submit"
          className="absolute bottom-[5px] right-[5px] top-[5px] flex w-[42px] items-center justify-center rounded-[5px] bg-cog-teal text-white transition-colors hover:bg-cog-teal-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
          )}
        </button>
      </div>
      {/* The value proposition moved to the guest tab's gold note (refined
          handoff §6) — the account tab explains only what to type here. */}
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {smsEnabled
          ? "Gib die E-Mail oder Handynummer ein, die bei uns hinterlegt ist — du erhältst einen einmaligen Login-Code."
          : "Gib die E-Mail-Adresse ein, die bei uns hinterlegt ist — du erhältst einen einmaligen Login-Code."}
      </p>
      {fieldError && (
        <p
          className="mt-2 text-sm text-destructive"
          role="alert"
          data-testid="checkin-signin-error"
        >
          {fieldError}
        </p>
      )}
    </form>
  )

  return (
    <div data-testid="checkin-signin">
      {/* Invisible reCAPTCHA anchor for Firebase phone auth — a fresh child
          element is mounted per SMS send (see newRecaptchaVerifier). */}
      <div ref={recaptchaHostRef} aria-hidden />

      {showLinkHint && (
        <div className="mb-3 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Ein Konto mit dieser E-Mail existiert bereits. Melde dich per
          E-Mail-Code an, um dein Google-Konto zu verknüpfen.
        </div>
      )}

      {/* Two equal columns on wide viewports — code sign-in left, the
          surface's second way in (badge on the kiosk, Google on personal
          devices) right — separated by a vertical "oder", so both read as
          peers. Below `sm` (phones, 3b) the columns stack behind a
          horizontal divider; the desktop column eyebrows and the Google
          hint are desktop-only per the mock. */}
      <div className="mt-1 flex flex-col gap-5 sm:flex-row sm:items-stretch sm:gap-[26px]">
        <div
          className={cn(
            "flex flex-col sm:flex-1 sm:min-w-0",
            kiosk ? "justify-center" : "sm:justify-start",
          )}
        >
          {!kiosk && <ColumnEyebrow>Mit Anmelde-Code</ColumnEyebrow>}
          {identifierForm}
        </div>
        <div
          className="hidden flex-col items-center gap-3.5 text-xs font-semibold tracking-[0.18em] text-muted-foreground sm:flex"
          aria-hidden
        >
          <span className="w-px flex-1 bg-border" />
          oder
          <span className="w-px flex-1 bg-border" />
        </div>
        <div
          className="flex items-center gap-3.5 text-xs font-semibold tracking-[0.18em] text-muted-foreground sm:hidden"
          aria-hidden
        >
          <span className="h-px flex-1 bg-border" />
          oder
          <span className="h-px flex-1 bg-border" />
        </div>
        <div
          className={cn(
            "flex flex-col sm:flex-1 sm:min-w-0",
            kiosk ? "justify-center" : "sm:justify-start",
          )}
        >
          {kiosk ? (
            children
          ) : (
            <>
              <ColumnEyebrow>Mit Google</ColumnEyebrow>
              <GoogleSignInButton
                className="h-[46px]"
                onNewAccount={handleGoogleNewAccount}
                onLinkHint={() => setShowLinkHint(true)}
              />
              <p className="mt-2 hidden text-[13px] leading-relaxed text-muted-foreground sm:block">
                Nutze dein bestehendes Google-Konto — kein Code nötig.
              </p>
            </>
          )}
        </div>
      </div>

      <CodeEntryDialog
        open={stage.kind === "code"}
        identifier={stage.kind === "code" ? stage.identifier : ""}
        note={kiosk ? "Der Code ist 5 Minuten gültig." : undefined}
        onCancel={reset}
        onResend={async (id) => {
          if (stage.kind === "code" && stage.channel === "sms") {
            // Parse + existence re-check are formalities here (both passed
            // on the way into the dialog); a null means the account vanished
            // mid-flow — surface it in the dialog instead of a stale toast.
            const e164 = await sendSmsCode(id)
            if (!e164) throw new Error("Code konnte nicht gesendet werden.")
            toast.success("Neuer Code gesendet!")
            return
          }
          const { throttled } = await requestCodeWithThrottle(
            requestLoginEmail,
            id,
          )
          toast[throttled ? "info" : "success"](
            throttled
              ? "Wir haben dir bereits eine E-Mail geschickt — der Code ist noch gültig."
              : "Neuer Code gesendet!",
          )
        }}
        onVerify={async (id, code) => {
          if (stage.kind === "code" && stage.channel === "sms") {
            await verifySmsCode(code)
          } else if (kiosk) {
            await verifyKioskCode(id, code)
          } else {
            await verifyLoginCode(id, code)
          }
        }}
      />

      {!kiosk && (
        <SignupDialog
          open={stage.kind === "signup"}
          via={stage.kind === "signup" ? stage.via : "code"}
          identifier={
            stage.kind === "signup"
              ? stage.identifier || user?.email || ""
              : ""
          }
          prefill={signupPrefill}
          onCancel={async () => {
            // A Google-new principal is already signed in (real session, no
            // user doc) — abandoning sign-up must sign out again, otherwise
            // the wizard treats the half-account as identified.
            if (stage.kind === "signup" && stage.via === "google") {
              try {
                await signOut()
              } catch (err) {
                console.error("signOut failed", err)
              }
            }
            setSignupPrefill(null)
            reset()
          }}
          onResend={async (id) => {
            const { throttled } = await requestCodeWithThrottle(
              requestLoginEmail,
              id,
            )
            toast[throttled ? "info" : "success"](
              throttled
                ? "Wir haben dir bereits eine E-Mail geschickt — der Code ist noch gültig."
                : "Neuer Code gesendet!",
            )
          }}
          onSubmit={async (via, id, value) => {
            const profile = signupProfileFrom(value)
            if (via === "code") {
              await verifyLoginCodeAndCreateProfile(id, value.code, profile)
            } else {
              await completeSignedInSignup(profile)
            }
            toast.success("Konto erstellt")
          }}
        />
      )}
    </div>
  )
}

/**
 * "Konto erstellen" in a dialog (own device only; refined handoff §4).
 * Fields top→bottom: read-only e-mail (no "Ändern" — closing the dialog is
 * the escape), confirmation code with inline resend (via "code" only),
 * Nutzer:in segmented control, name fields, firma address (validation
 * requires it), terms, full-width primary. Via "google" the principal is
 * already signed in, so the code row is omitted.
 */
function SignupDialog({
  open,
  via,
  identifier,
  prefill,
  onCancel,
  onResend,
  onSubmit,
}: {
  open: boolean
  via: "code" | "google"
  identifier: string
  prefill: { firstName: string; lastName: string } | null
  onCancel: () => void | Promise<void>
  onResend: (identifier: string) => Promise<void>
  onSubmit: (
    via: "code" | "google",
    identifier: string,
    value: SignupFieldsValue,
  ) => Promise<void>
}) {
  const [value, setValue] = useState<SignupFieldsValue>(EMPTY_SIGNUP_VALUE)
  const [errors, setErrors] = useState<SignupFieldsErrors>({})
  const [busy, setBusy] = useState(false)
  // Re-seed the form whenever the dialog (re)opens.
  const [seededOpen, setSeededOpen] = useState(false)
  if (open && !seededOpen) {
    setSeededOpen(true)
    setValue(
      prefill ? { ...EMPTY_SIGNUP_VALUE, ...prefill } : EMPTY_SIGNUP_VALUE,
    )
    setErrors({})
  }
  if (!open && seededOpen) setSeededOpen(false)

  const handleOpenChange = (next: boolean) => {
    if (busy) return
    if (!next) void onCancel()
  }

  const patch = (p: Partial<SignupFieldsValue>) =>
    setValue((v) => ({ ...v, ...p }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validateSignupFields(value, { requireCode: via === "code" })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    try {
      await onSubmit(via, identifier, value)
      // Success flips the wizard to the signed-in view and unmounts us.
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fehler"
      if (via === "code") setErrors({ code: message })
      else toast.error(`Fehler: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  const labelCls = "mb-1.5 block text-sm font-bold"
  const inputCls = (invalid: boolean) =>
    cn(
      "h-11 w-full rounded-md border bg-white px-3 text-base md:text-[15px] shadow-xs outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-60",
      invalid
        ? "border-destructive focus:border-destructive focus:ring-[3px] focus:ring-destructive/30"
        : "border-[#ccc] focus:border-cog-teal focus:ring-[3px] focus:ring-cog-teal/30",
    )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto rounded-[14px] p-6 sm:max-w-[420px] sm:px-[34px] sm:pb-[30px] sm:pt-8"
        data-testid="checkin-signup-dialog"
      >
        <DialogHeader className="text-left">
          <DialogTitle className="font-heading text-xl">
            Konto erstellen
          </DialogTitle>
          <DialogDescription className="text-[13.5px]">
            {via === "code"
              ? "Für diese E-Mail-Adresse gibt es noch kein Konto."
              : "Noch ein paar Angaben, dann ist dein Konto bereit."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-[18px]">
          <div>
            <span className={labelCls}>E-Mail</span>
            {/* Read-only on purpose — a different address means closing the
                dialog (×) and typing it in the identifier field. */}
            <div
              data-testid="signup-email-readonly"
              className="flex h-11 items-center rounded-md border border-border bg-secondary px-3.5 text-[15px] text-muted-foreground"
            >
              {identifier}
            </div>
          </div>

          {via === "code" && (
            <div>
              <label htmlFor="signup-code" className={labelCls}>
                Bestätigungscode
                <span className="ml-0.5 text-destructive">*</span>
              </label>
              <p className="mb-2 text-[12.5px] leading-relaxed text-muted-foreground">
                Wir haben dir einen 6-stelligen Code an diese Adresse
                geschickt — so bestätigst du, dass sie dir gehört.{" "}
                <button
                  type="button"
                  onClick={() => void onResend(identifier)}
                  disabled={busy}
                  className="text-cog-teal-dark underline hover:no-underline disabled:opacity-60"
                >
                  Code erneut senden
                </button>
              </p>
              <input
                id="signup-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={value.code}
                onChange={(e) =>
                  patch({ code: e.target.value.replace(/\D/g, "") })
                }
                disabled={busy}
                data-testid="signup-code-input"
                className={cn(
                  inputCls(!!errors.code),
                  "h-[52px] text-center font-heading text-2xl font-bold tracking-[0.42em]",
                )}
              />
              {errors.code && (
                <p className="mt-1.5 text-sm text-destructive" role="alert">
                  {errors.code}
                </p>
              )}
            </div>
          )}

          <div>
            <span className={labelCls}>Nutzer:in</span>
            <p className="mb-2 text-[12.5px] leading-relaxed text-muted-foreground">
              Bestimmt die Nutzungsgebühr in der Werkstatt.
            </p>
            <div
              role="radiogroup"
              aria-label="Nutzer:in"
              className="grid grid-cols-3 overflow-hidden rounded-lg border border-border"
            >
              {(Object.entries(USER_TYPE_LABELS) as [UserType, string][]).map(
                ([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={value.userType === type}
                    data-testid={`signup-membertype-${type}`}
                    onClick={() => patch({ userType: type })}
                    disabled={busy}
                    className={cn(
                      "h-[46px] border-r border-border text-sm font-semibold transition-colors last:border-r-0",
                      value.userType === type
                        ? "bg-cog-teal text-white"
                        : "bg-white text-foreground hover:bg-cog-teal-light",
                    )}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          <div>
            <label htmlFor="signup-firstname" className={labelCls}>
              Vorname
              <span className="ml-0.5 text-destructive">*</span>
            </label>
            <input
              id="signup-firstname"
              autoComplete="given-name"
              value={value.firstName}
              onChange={(e) => patch({ firstName: e.target.value })}
              disabled={busy}
              data-testid="signup-firstname"
              className={inputCls(!!errors.firstName)}
            />
            {errors.firstName && (
              <p className="mt-1.5 text-sm text-destructive" role="alert">
                {errors.firstName}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="signup-lastname" className={labelCls}>
              Nachname
              <span className="ml-0.5 text-destructive">*</span>
            </label>
            <input
              id="signup-lastname"
              autoComplete="family-name"
              value={value.lastName}
              onChange={(e) => patch({ lastName: e.target.value })}
              disabled={busy}
              data-testid="signup-lastname"
              className={inputCls(!!errors.lastName)}
            />
            {errors.lastName && (
              <p className="mt-1.5 text-sm text-destructive" role="alert">
                {errors.lastName}
              </p>
            )}
          </div>

          {/* Not in the handoff mock, but a firma account can't be created
              without its billing address (validateSignupFields). */}
          {value.userType === "firma" && (
            <AddressFields
              value={value.address}
              errors={errors.address}
              onChange={(p) => patch({ address: { ...value.address, ...p } })}
              includeCompany
              showEyebrow={false}
              idPrefix="signup-addr"
            />
          )}

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox
              id="signup-terms"
              data-testid="signup-terms"
              className="mt-0.5 bg-white"
              checked={value.termsAccepted}
              onCheckedChange={(checked) =>
                patch({ termsAccepted: checked === true })
              }
              disabled={busy}
            />
            <span>
              Ich akzeptiere die{" "}
              <a
                href="https://werkstattwaedi.ch/nutzungsbestimmungen"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-bold text-cog-teal-dark underline"
              >
                Nutzungsbestimmungen
              </a>
            </span>
          </label>
          {errors.termsAccepted && (
            <p className="-mt-3 text-sm text-destructive" role="alert">
              {errors.termsAccepted}
            </p>
          )}

          <Button
            type="submit"
            disabled={busy}
            data-testid="checkin-signup-submit"
            className="h-[46px] w-full bg-cog-teal text-[15px] font-semibold text-white hover:bg-cog-teal-dark"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Konto erstellen
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
