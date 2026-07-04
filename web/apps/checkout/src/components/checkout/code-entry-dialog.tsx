// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The "Code eingeben" modal (design handoff "Kiosk sign-in flow redesign"):
 * 6-box OTP input, resend link, primary action / Abbrechen. Closing
 * (Abbrechen, Esc, scrim click) returns to the host's idle state via
 * `onCancel`. Shared between the embedded check-in sign-in (e-mail + SMS
 * codes) and the profile phone verification (ADR-0031).
 */

import { useState } from "react"
import { ArrowRight, Loader2 } from "lucide-react"
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

export function messageFromError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg.length > 0) return msg
  }
  return fallback
}

export function CodeEntryDialog({
  open,
  identifier,
  note,
  submitLabel = "Anmelden",
  onCancel,
  onResend,
  onVerify,
}: {
  open: boolean
  /** Where the code went — shown bold in the subtitle. */
  identifier: string
  /** Optional extra sentence after the subtitle (e.g. code validity). */
  note?: string
  submitLabel?: string
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
      // Success unmounts / closes via the host — no local cleanup needed.
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
      <DialogContent
        className="rounded-[14px] p-6 sm:max-w-[420px] sm:px-[34px] sm:pb-[30px] sm:pt-8"
        data-testid="checkin-code-dialog"
      >
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
            {note && ` ${note}`}
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
            containerClassName="justify-center"
            aria-label="6-stelliger Code"
            data-testid="checkin-code-input"
          >
            <InputOTPGroup className="justify-center gap-[7px] sm:gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-[50px] w-10 rounded-md border border-[#ccc] font-heading text-[22px] font-bold sm:h-[54px] sm:w-11 sm:text-2xl data-[active=true]:border-cog-teal data-[active=true]:ring-[3px] data-[active=true]:ring-cog-teal/30"
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
          <div className="mt-1 text-center">
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
              {submitLabel}
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
