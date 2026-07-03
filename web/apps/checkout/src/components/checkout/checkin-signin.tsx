// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Embedded account sign-in on /checkin (design handoff "Kiosk sign-in flow
 * redesign", surfaces 3a/3b). Renders the account side of the check-in
 * switcher: a member note, a single identifier field with an inline submit
 * arrow, and — below an "oder" divider — the kiosk NFC affordance (passed
 * as children) or, on a personal device, the Google button.
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

import { useState } from "react"
import { toast } from "sonner"
import { ArrowRight, Loader2 } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { useFunctions, useFirebaseAuth } from "@modules/lib/firebase-context"
import { resolveBridgeBearer } from "@modules/lib/use-bridge"
import { rpcCallable } from "@modules/lib/rpc"
import { establishKioskSession, type TokenUser } from "@modules/lib/token-auth"
import {
  GoogleSignInButton,
  requestCodeWithThrottle,
  SignupFields,
  EMPTY_SIGNUP_VALUE,
  validateSignupFields,
  signupProfileFrom,
  type SignupFieldsValue,
  type SignupFieldsErrors,
} from "@modules/components/auth"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Button } from "@modules/components/ui/button"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@modules/components/ui/input-otp"

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

interface VerifyLoginCodeKioskResponse {
  customToken: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  activeMembership?: boolean
}

function messageFromError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg.length > 0) return msg
  }
  return fallback
}

type Stage =
  | { kind: "idle" }
  | { kind: "code"; identifier: string }
  | { kind: "signup"; via: "code" | "google"; identifier: string }

export interface CheckinSigninProps {
  kiosk: boolean
  /** Step 2 (SMS login codes): enables phone-number detection. Default off. */
  smsEnabled?: boolean
  /** Rendered below the "oder" divider on the kiosk — the NFC affordance. */
  children?: React.ReactNode
}

export function CheckinSignin({
  kiosk,
  smsEnabled = false,
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

  const [stage, setStage] = useState<Stage>({ kind: "idle" })
  const [identifier, setIdentifier] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [showLinkHint, setShowLinkHint] = useState(false)
  const [busy, setBusy] = useState(false)

  const channel = detectChannel(identifier, smsEnabled)

  const reset = () => {
    setStage({ kind: "idle" })
    setIdentifier("")
    setFieldError(null)
    setBusy(false)
  }

  const submitIdentifier = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!channel || busy) return
    const id = identifier.trim()
    setBusy(true)
    setFieldError(null)
    try {
      // SMS lands in step 2 (Firebase phone auth) — the channel detection
      // is already wired so the field behaves per the design once enabled.
      if (channel !== "email") {
        setFieldError("SMS-Anmeldung ist noch nicht verfügbar.")
        return
      }
      const { exists } = await checkAccountExists(id)
      if (kiosk) {
        // No sign-up at the shared terminal (ADR-0022).
        if (!exists) {
          setFieldError(
            "Für diese E-Mail existiert noch kein Konto. Bitte registriere dich zuerst auf deinem eigenen Gerät.",
          )
          return
        }
        await requestCodeWithThrottle(requestLoginEmail, id)
        setStage({ kind: "code", identifier: id })
        return
      }
      // Own device: the sign-up form needs the code too, so request it for
      // both branches (same as /login).
      const { throttled } = await requestCodeWithThrottle(requestLoginEmail, id)
      if (throttled) {
        toast.info(
          "Wir haben dir bereits eine E-Mail geschickt — der Code ist noch gültig.",
        )
      }
      setStage(
        exists
          ? { kind: "code", identifier: id }
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

  return (
    <div data-testid="checkin-signin">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Melde dich mit deinem Konto an —{" "}
        <b className="font-semibold text-foreground">
          nur so gelten die Mitglieder-Preise
        </b>
        <span className="hidden sm:inline">
          . Ohne Konto zahlst du den Gast-Tarif.
        </span>
        <span className="sm:hidden">.</span>
      </p>

      {showLinkHint && (
        <div className="mt-3 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Ein Konto mit dieser E-Mail existiert bereits. Melde dich per
          E-Mail-Code an, um dein Google-Konto zu verknüpfen.
        </div>
      )}

      <form className="mt-4" onSubmit={submitIdentifier} noValidate>
        <label
          htmlFor="checkin-identifier"
          className="mb-1.5 block text-sm font-bold"
        >
          {smsEnabled ? "E-Mail oder Handynummer" : "E-Mail"}
        </label>
        <div className="relative sm:max-w-[440px]">
          <input
            id="checkin-identifier"
            type={smsEnabled ? "text" : "email"}
            inputMode={smsEnabled ? "text" : "email"}
            autoComplete="off"
            placeholder="name@beispiel.ch"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value)
              if (fieldError) setFieldError(null)
            }}
            disabled={busy}
            data-testid="checkin-identifier"
            className="h-[42px] w-full rounded-md border border-[#ccc] bg-white pl-3 pr-[54px] text-[15px] shadow-xs outline-none transition-[color,box-shadow] focus:border-cog-teal focus:ring-[3px] focus:ring-cog-teal/30 disabled:cursor-not-allowed disabled:opacity-60"
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

      <div
        className="my-6 flex items-center gap-3.5 text-xs font-semibold tracking-[0.18em] text-muted-foreground"
        aria-hidden
      >
        <span className="h-px flex-1 bg-border" />
        oder
        <span className="h-px flex-1 bg-border" />
      </div>

      {kiosk ? (
        children
      ) : (
        <div className="sm:max-w-[440px]">
          <GoogleSignInButton
            onNewAccount={handleGoogleNewAccount}
            onLinkHint={() => setShowLinkHint(true)}
          />
        </div>
      )}

      <CodeDialog
        open={stage.kind === "code"}
        identifier={stage.kind === "code" ? stage.identifier : ""}
        kiosk={kiosk}
        onCancel={reset}
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
        onVerify={async (id, code) => {
          if (kiosk) await verifyKioskCode(id, code)
          else await verifyLoginCode(id, code)
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
 * The "Code eingeben" modal (handoff §3): 6-box OTP input, resend link,
 * Anmelden / Abbrechen. Closing (Abbrechen, Esc, scrim click) returns to the
 * idle state via `onCancel`.
 */
function CodeDialog({
  open,
  identifier,
  kiosk,
  onCancel,
  onResend,
  onVerify,
}: {
  open: boolean
  identifier: string
  kiosk: boolean
  onCancel: () => void
  onResend: (identifier: string) => Promise<void>
  onVerify: (identifier: string, code: string) => Promise<void>
}) {
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (busy) return
    if (!next) {
      setCode("")
      setError(null)
      onCancel()
    }
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (code.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      await onVerify(identifier, code)
      // Success unmounts the host component — no local cleanup needed.
    } catch (err) {
      setError(
        messageFromError(err, "Anmeldung fehlgeschlagen. Bitte versuche es erneut."),
      )
      setCode("")
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onResend(identifier)
      setCode("")
    } catch (err) {
      setError(messageFromError(err, "Code konnte nicht gesendet werden."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[404px]" data-testid="checkin-code-dialog">
        <DialogHeader className="text-left">
          <DialogTitle className="font-heading text-xl">
            Code eingeben
          </DialogTitle>
          <DialogDescription className="text-[13.5px]">
            <span className="hidden sm:inline">
              Wir haben einen 6-stelligen Code an{" "}
              <b className="font-semibold text-foreground">{identifier}</b>{" "}
              gesendet.
            </span>
            <span className="sm:hidden">
              6-stelliger Code an{" "}
              <b className="font-semibold text-foreground">{identifier}</b>{" "}
              gesendet.
            </span>
            {kiosk && " Der Code ist 5 Minuten gültig."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={(next) => {
              setCode(next.replace(/\D/g, ""))
              if (error) setError(null)
            }}
            disabled={busy}
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            containerClassName="justify-between"
            aria-label="6-stelliger Code"
            data-testid="checkin-code-input"
          >
            <InputOTPGroup className="w-full justify-between gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-[54px] w-[46px] rounded-md border border-[#ccc] font-heading text-2xl font-bold data-[active=true]:border-cog-teal data-[active=true]:ring-[3px] data-[active=true]:ring-cog-teal/30"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="checkin-code-error"
            >
              {error}
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={() => void resend()}
              disabled={busy}
              data-testid="checkin-code-resend"
              className="text-[13px] text-cog-teal-dark underline hover:no-underline disabled:opacity-60"
            >
              Code erneut senden
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Button
              type="submit"
              disabled={busy || code.length !== 6}
              data-testid="checkin-code-submit"
              className="h-[42px] bg-cog-teal px-5 text-[15px] font-semibold text-white hover:bg-cog-teal-dark"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Anmelden
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
              data-testid="checkin-code-cancel"
              className="h-[42px] px-5 text-[15px] font-semibold"
            >
              Abbrechen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Sign-up in a dialog (own device only). Hosts the same SignupFields form as
 * /login: via "code" (unknown e-mail — code entered inline) or via "google"
 * (already signed in, no code).
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
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
        <form onSubmit={submit} className="flex flex-col gap-5">
          <SignupFields
            value={value}
            errors={errors}
            onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
            showCode={via === "code"}
            email={identifier || undefined}
            emailAction={{
              label: via === "code" ? "Ändern" : "Abmelden",
              onClick: () => handleOpenChange(false),
            }}
            onResendCode={
              via === "code" ? () => void onResend(identifier) : undefined
            }
          />
          <Button
            type="submit"
            disabled={busy}
            data-testid="checkin-signup-submit"
            className="h-[42px] bg-cog-teal text-[15px] font-semibold text-white hover:bg-cog-teal-dark"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Konto erstellen
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
