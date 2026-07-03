// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk email-code sign-in (ADR-0022). Lets a registered user without their
 * badge sign in at the kiosk with the 6-digit email code. Deliberately NOT
 * the /login flow: that mints a real persistent session; here the verified
 * code mints the same lightweight synthetic `actsAs` session a badge tap
 * produces (verifyLoginCodeKiosk), so wizard pre-fill, member pricing, and
 * the volatile-partition lifecycle all behave exactly like a badge tap.
 * There is no sign-up on the kiosk — new users register on their own device.
 */

import { useState } from "react"
import { Loader2, Mail } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { useFunctions, useFirebaseAuth } from "@modules/lib/firebase-context"
import { resolveBridgeBearer } from "@modules/lib/use-bridge"
import { rpcCallable } from "@modules/lib/rpc"
import { establishKioskSession, type TokenUser } from "@modules/lib/token-auth"
import { isResendThrottleError } from "@modules/components/auth/login-page"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"

interface VerifyLoginCodeKioskResponse {
  customToken: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  activeMembership?: boolean
}

type Stage = { kind: "email" } | { kind: "code"; email: string }

function messageFromError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg.length > 0) return msg
  }
  return fallback
}

export function KioskEmailSignin() {
  const { checkAccountExists, requestLoginEmail } = useAuth()
  const functions = useFunctions()
  const auth = useFirebaseAuth()

  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: "email" })
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStage({ kind: "email" })
    setEmail("")
    setCode("")
    setBusy(false)
    setError(null)
  }

  const sendCode = async (targetEmail: string): Promise<void> => {
    try {
      await requestLoginEmail(targetEmail)
    } catch (err) {
      // Throttled = a still-valid code was already sent; advancing is the
      // correct UX (same treatment as login-page.tsx).
      if (!isResendThrottleError(err)) throw err
    }
  }

  const submitEmail = async () => {
    const trimmed = email.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const { exists } = await checkAccountExists(trimmed)
      if (!exists) {
        setError(
          "Für diese E-Mail existiert noch kein Konto. Bitte registriere dich zuerst auf deinem eigenen Gerät."
        )
        return
      }
      await sendCode(trimmed)
      setStage({ kind: "code", email: trimmed })
    } catch (err) {
      setError(
        messageFromError(err, "E-Mail konnte nicht geprüft werden. Bitte versuche es erneut.")
      )
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (targetEmail: string) => {
    if (!/^\d{6}$/.test(code)) {
      setError("Bitte den 6-stelligen Code eingeben.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bearer = await resolveBridgeBearer()
      const verifyKioskCode = rpcCallable<
        { email: string; code: string; bearer?: string },
        VerifyLoginCodeKioskResponse
      >(functions, "authCall", "verifyLoginCodeKiosk")
      const { data } = await verifyKioskCode({
        email: targetEmail,
        code,
        bearer: bearer ?? undefined,
      })
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
      // unmounts this dialog's host block — just close.
      setOpen(false)
      reset()
    } catch (err) {
      setError(messageFromError(err, "Anmeldung fehlgeschlagen. Bitte versuche es erneut."))
    } finally {
      setBusy(false)
    }
  }

  const resend = async (targetEmail: string) => {
    setBusy(true)
    setError(null)
    try {
      await sendCode(targetEmail)
    } catch (err) {
      setError(messageFromError(err, "Code konnte nicht gesendet werden."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex justify-center">
        <Button
          type="button"
          variant="ghost"
          className="text-cog-teal underline underline-offset-4"
          data-testid="kiosk-signin-open"
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          <Mail className="h-4 w-4" aria-hidden />
          Kein Badge dabei? Mit E-Mail-Code anmelden
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent className="sm:max-w-md">
          {stage.kind === "email" ? (
            <>
              <DialogHeader>
                <DialogTitle>Mit E-Mail-Code anmelden</DialogTitle>
                <DialogDescription>
                  Gib die E-Mail-Adresse deines Kontos ein. Wir senden dir
                  einen 6-stelligen Anmeldecode.
                </DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitEmail()
                }}
              >
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="E-Mail-Adresse"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  autoFocus
                  className="h-12 text-base"
                  data-testid="kiosk-signin-email"
                />
                {error && (
                  <p
                    className="text-sm text-destructive"
                    role="alert"
                    data-testid="kiosk-signin-error"
                  >
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={busy || !email.trim()}
                  className="h-12"
                  data-testid="kiosk-signin-email-submit"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Code senden
                </Button>
              </form>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Code eingeben</DialogTitle>
                <DialogDescription>
                  Wir haben einen Anmeldecode an {stage.email} gesendet. Der
                  Code ist 5 Minuten gültig.
                </DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitCode(stage.email)
                }}
              >
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="6-stelliger Code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  disabled={busy}
                  autoFocus
                  className="h-12 text-center text-2xl tracking-[0.5em]"
                  data-testid="kiosk-signin-code"
                />
                {error && (
                  <p
                    className="text-sm text-destructive"
                    role="alert"
                    data-testid="kiosk-signin-error"
                  >
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="h-12"
                  data-testid="kiosk-signin-code-submit"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Anmelden
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline underline-offset-4 disabled:opacity-60"
                  onClick={() => void resend(stage.email)}
                  disabled={busy}
                >
                  Code erneut senden
                </button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
