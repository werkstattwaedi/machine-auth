// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk step-up (ADR-0041): before an `actsAs` session may open the member
 * area it proves a second factor bound to the account's own contact
 * address. A badge tap alone never gets there.
 *
 * Flow: interstitial "Code senden an: [SMS] [E-Mail]" (channels from
 * `getKioskElevationOptions`; SMS first when the account has an
 * Auth-linked phone, a single button when only e-mail exists) → the shared
 * CodeEntryDialog → the re-minted session carries `elevatedUntil` and the
 * queued navigation runs once the auth context has seen the new claims.
 *
 * Mounted once at the root (`KioskElevationProvider`); callers use
 * `useKioskElevation().ensureElevated(next)`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Loader2, Mail, MessageSquareText, ShieldCheck } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Button } from "@modules/components/ui/button"
import { useAuth } from "@modules/lib/auth"
import { useFirebaseAuth, useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable, prewarm } from "@modules/lib/rpc"
import { resolveBridgeBearer } from "@modules/lib/use-bridge"
import {
  establishKioskSession,
  getKioskTokenUser,
  type TokenUser,
} from "@modules/lib/token-auth"
import { CodeEntryDialog, messageFromError } from "./code-entry-dialog"
import { useKioskSms } from "./use-kiosk-sms"

interface ElevationOptions {
  email: { masked: string } | null
  sms: { masked: string; phoneNumber: string } | null
}

interface VerifyKioskElevationResponse {
  customToken: string
  userId: string
  firstName?: string
  lastName?: string
  email?: string
  userType?: string
  activeMembership?: boolean
  elevatedUntil?: number | null
}

type Stage =
  | { kind: "closed" }
  | { kind: "options"; options: ElevationOptions | null; error: string | null }
  | { kind: "code"; channel: "email" | "sms"; identifier: string }

interface KioskElevationContextValue {
  /**
   * Run `next` with an elevated kiosk session: immediately when the session
   * already is, otherwise after the visitor completes the step-up dialog.
   * Cancelling the dialog drops `next`.
   */
  ensureElevated: (next: () => void) => void
}

const KioskElevationContext = createContext<KioskElevationContextValue | null>(
  null,
)

export function useKioskElevation(): KioskElevationContextValue {
  const ctx = useContext(KioskElevationContext)
  if (!ctx) {
    throw new Error("useKioskElevation must be used within KioskElevationProvider")
  }
  return ctx
}

export function KioskElevationProvider({ children }: { children: ReactNode }) {
  const { isKioskElevated } = useAuth()
  const auth = useFirebaseAuth()
  const functions = useFunctions()
  const sms = useKioskSms()
  const [stage, setStage] = useState<Stage>({ kind: "closed" })
  const [busy, setBusy] = useState(false)
  // The navigation queued by ensureElevated. Runs only once the auth
  // context reports the re-minted claims — navigating earlier would let the
  // member-area guard see an un-elevated tag session and bounce.
  const pendingNextRef = useRef<(() => void) | null>(null)
  const [awaitingClaims, setAwaitingClaims] = useState(false)

  useEffect(() => {
    if (!awaitingClaims || !isKioskElevated) return
    setAwaitingClaims(false)
    const next = pendingNextRef.current
    pendingNextRef.current = null
    next?.()
  }, [awaitingClaims, isKioskElevated])

  const loadOptions = useCallback(async () => {
    try {
      const bearer = await resolveBridgeBearer()
      const getOptions = rpcCallable<{ bearer?: string }, ElevationOptions>(
        functions,
        "authCall",
        "getKioskElevationOptions",
      )
      const { data } = await getOptions({ bearer: bearer ?? undefined })
      setStage({ kind: "options", options: data, error: null })
    } catch (err) {
      setStage({
        kind: "options",
        options: null,
        error: messageFromError(err, "Optionen konnten nicht geladen werden."),
      })
    }
  }, [functions])

  const ensureElevated = useCallback(
    (next: () => void) => {
      if (isKioskElevated) {
        next()
        return
      }
      pendingNextRef.current = next
      prewarm(functions, "authCall")
      setStage({ kind: "options", options: null, error: null })
      void loadOptions()
    },
    [isKioskElevated, functions, loadOptions],
  )

  const cancel = () => {
    if (busy) return
    pendingNextRef.current = null
    sms.clear()
    setStage({ kind: "closed" })
  }

  const sendEmail = async () => {
    setBusy(true)
    try {
      const bearer = await resolveBridgeBearer()
      const request = rpcCallable<{ bearer?: string }, { masked: string }>(
        functions,
        "authCall",
        "requestKioskElevation",
      )
      const { data } = await request({ bearer: bearer ?? undefined })
      setStage({ kind: "code", channel: "email", identifier: data.masked })
    } catch (err) {
      setStage((s) =>
        s.kind === "options"
          ? { ...s, error: messageFromError(err, "Code konnte nicht gesendet werden.") }
          : s,
      )
    } finally {
      setBusy(false)
    }
  }

  const sendSms = async (option: { masked: string; phoneNumber: string }) => {
    setBusy(true)
    try {
      await sms.sendCode(option.phoneNumber)
      setStage({ kind: "code", channel: "sms", identifier: option.masked })
    } catch (err) {
      setStage((s) =>
        s.kind === "options"
          ? { ...s, error: messageFromError(err, "SMS konnte nicht gesendet werden.") }
          : s,
      )
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (stage.kind !== "code") return
    if (stage.channel === "email") {
      const bearer = await resolveBridgeBearer()
      const request = rpcCallable<{ bearer?: string }, { masked: string }>(
        functions,
        "authCall",
        "requestKioskElevation",
      )
      await request({ bearer: bearer ?? undefined })
      return
    }
    // SMS resend needs the number again — re-read the options (cheap) so
    // the full E.164 value never sits in dialog state longer than needed.
    const bearer = await resolveBridgeBearer()
    const getOptions = rpcCallable<{ bearer?: string }, ElevationOptions>(
      functions,
      "authCall",
      "getKioskElevationOptions",
    )
    const { data } = await getOptions({ bearer: bearer ?? undefined })
    if (!data.sms) throw new Error("Keine Handynummer hinterlegt.")
    await sms.sendCode(data.sms.phoneNumber)
  }

  const verify = async (_identifier: string, code: string) => {
    if (stage.kind !== "code") return
    const current = getKioskTokenUser()
    if (stage.channel === "sms") {
      await sms.confirmAndExchange(code, current?.userId)
    } else {
      const bearer = await resolveBridgeBearer()
      const verifyFn = rpcCallable<
        { bearer?: string; code: string },
        VerifyKioskElevationResponse
      >(functions, "authCall", "verifyKioskElevation")
      const { data } = await verifyFn({ bearer: bearer ?? undefined, code })
      const tokenUser: TokenUser = {
        tokenId: current?.tokenId ?? null,
        userId: data.userId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        userType: data.userType,
        activeMembership: data.activeMembership,
        elevatedUntil: data.elevatedUntil ?? null,
      }
      await establishKioskSession(auth, data.customToken, tokenUser)
    }
    setStage({ kind: "closed" })
    setAwaitingClaims(true)
  }

  return (
    <KioskElevationContext value={{ ensureElevated }}>
      {children}
      {/* Stable reCAPTCHA host for the SMS branch (see useKioskSms). */}
      <div ref={sms.recaptchaHostRef} aria-hidden />
      <Dialog
        open={stage.kind === "options"}
        onOpenChange={(next) => {
          if (!next) cancel()
        }}
      >
        <DialogContent
          className="rounded-[14px] p-6 sm:max-w-[440px] sm:px-[34px] sm:pb-[30px] sm:pt-8"
          data-testid="kiosk-elevation-dialog"
        >
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 font-heading text-xl">
              <ShieldCheck className="h-5 w-5 text-cog-teal" aria-hidden />
              Kurz bestätigen
            </DialogTitle>
            <DialogDescription className="text-[13.5px]">
              Zur Sicherheit bestätigen wir kurz, dass du das bist. Wohin
              sollen wir den Code senden?
            </DialogDescription>
          </DialogHeader>
          {stage.kind === "options" && !stage.options && !stage.error && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </div>
          )}
          {stage.kind === "options" && stage.options && (
            <div className="flex flex-col gap-2.5">
              {stage.options.sms && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void sendSms(stage.options!.sms!)}
                  data-testid="kiosk-elevation-sms"
                  className="h-[46px] justify-start gap-3 bg-cog-teal px-4 text-[15px] font-semibold text-white hover:bg-cog-teal-dark"
                >
                  <MessageSquareText className="h-4 w-4" aria-hidden />
                  SMS an {stage.options.sms.masked}
                </Button>
              )}
              {stage.options.email && (
                <Button
                  type="button"
                  variant={stage.options.sms ? "outline" : "default"}
                  disabled={busy}
                  onClick={() => void sendEmail()}
                  data-testid="kiosk-elevation-email"
                  className={
                    stage.options.sms
                      ? "h-[46px] justify-start gap-3 px-4 text-[15px] font-semibold"
                      : "h-[46px] justify-start gap-3 bg-cog-teal px-4 text-[15px] font-semibold text-white hover:bg-cog-teal-dark"
                  }
                >
                  <Mail className="h-4 w-4" aria-hidden />
                  E-Mail an {stage.options.email.masked}
                </Button>
              )}
              {!stage.options.sms && !stage.options.email && (
                <p className="text-sm text-destructive" role="alert">
                  Für dieses Konto ist keine Kontaktadresse hinterlegt.
                </p>
              )}
            </div>
          )}
          {stage.kind === "options" && stage.error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="kiosk-elevation-error"
            >
              {stage.error}
            </p>
          )}
          <div className="mt-1 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={cancel}
              disabled={busy}
              data-testid="kiosk-elevation-cancel"
              className="text-[15px] font-semibold"
            >
              Abbrechen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {stage.kind === "code" && (
        <CodeEntryDialog
          open
          identifier={stage.identifier}
          note={stage.channel === "email" ? "Der Code ist 5 Minuten gültig." : undefined}
          submitLabel="Bestätigen"
          onCancel={cancel}
          onResend={async () => {
            await resend()
          }}
          onVerify={verify}
        />
      )}
    </KioskElevationContext>
  )
}
