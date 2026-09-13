// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The "Anmelde-Code eingeben" modal (design handoff "OTP Dialog"): three
 * bands — header with the inline resend link, the 6-box code entry, and an
 * animated single-slot notice bar above a full-bleed action footer. Closing
 * (Abbrechen, Esc, scrim click, X) returns to the host's idle state via
 * `onCancel`. Shared between the embedded check-in sign-in (e-mail + SMS
 * codes) and the profile phone verification (ADR-0031).
 */

import { useState } from "react"
import { ArrowRight, Check, CircleAlert, Info, Loader2, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@modules/components/ui/dialog"
import { Button } from "@modules/components/ui/button"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@modules/components/ui/input-otp"
import { cn } from "@modules/lib/utils"

export function messageFromError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg.length > 0) return msg
  }
  return fallback
}

type NoticeKind = "info" | "error" | "success"
type Notice = { kind: NoticeKind; text: string }

// One bar, never stacked: the newest state replaces the previous one in
// place and the colors cross-fade. Error is the only assertive one.
const NOTICE_STYLE: Record<
  NoticeKind,
  { className: string; Icon: typeof Info; role: "status" | "alert" }
> = {
  info: {
    className: "bg-oww-gold-light text-oww-gold-text-muted",
    Icon: Info,
    role: "status",
  },
  error: {
    className: "bg-destructive-bg text-destructive-solid",
    Icon: CircleAlert,
    role: "alert",
  },
  success: {
    className: "bg-cog-teal-light text-cog-teal-dark",
    Icon: Check,
    role: "status",
  },
}

type CodeEntryProps = {
  /** Where the code went — shown bold in the subtitle. */
  identifier: string
  /** Optional extra sentence after the subtitle (e.g. code validity). */
  note?: string
  submitLabel?: string
  onCancel: () => void
  /**
   * Re-sends the code. The resolved string (if any) is shown in the info
   * notice bar — e.g. a throttle explanation; otherwise a generic
   * "sent again" line is shown.
   */
  onResend: (identifier: string) => Promise<string | void>
  onVerify: (identifier: string, code: string) => Promise<void>
}

export function CodeEntryDialog({
  open,
  ...props
}: CodeEntryProps & { open: boolean }) {
  // `busy` lives here so a close attempt can be refused mid-request; the
  // rest of the state lives in the panel, which unmounts with the dialog
  // content and so starts fresh on every open.
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (busy) return
    if (!next) props.onCancel()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[440px]"
        data-testid="checkin-code-dialog"
      >
        <CodeEntryPanel
          {...props}
          busy={busy}
          setBusy={setBusy}
          onClose={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CodeEntryPanel({
  identifier,
  note,
  submitLabel = "Anmelden",
  busy,
  setBusy,
  onClose,
  onResend,
  onVerify,
}: Omit<CodeEntryProps, "onCancel"> & {
  busy: boolean
  setBusy: (busy: boolean) => void
  onClose: () => void
}) {
  const [code, setCode] = useState("")
  const [success, setSuccess] = useState(false)
  // The outgoing bar keeps its text/colors while collapsing so it doesn't
  // blink empty mid-animation — hiding only flips `visible`.
  const [bar, setBar] = useState<{ visible: boolean; notice: Notice | null }>(
    { visible: false, notice: null },
  )
  const showNotice = (notice: Notice) => setBar({ visible: true, notice })
  const hideNotice = () => setBar((prev) => ({ ...prev, visible: false }))

  const complete = code.length === 6
  const canSubmit = complete && !busy && !success

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    hideNotice()
    try {
      await onVerify(identifier, code)
      // The host closes the dialog; the success bar shows during exit.
      setSuccess(true)
      showNotice({
        kind: "success",
        text: "Code bestätigt — du wirst angemeldet.",
      })
    } catch (err) {
      // Code stays in place for correction.
      showNotice({
        kind: "error",
        text: messageFromError(
          err,
          "Anmeldung fehlgeschlagen. Bitte versuche es erneut.",
        ),
      })
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (busy || success) return
    setBusy(true)
    hideNotice()
    try {
      const message = await onResend(identifier)
      showNotice({ kind: "info", text: message || "Neuer Code gesendet." })
    } catch (err) {
      showNotice({
        kind: "error",
        text: messageFromError(err, "Code konnte nicht gesendet werden."),
      })
    } finally {
      setBusy(false)
    }
  }

  const style = bar.notice ? NOTICE_STYLE[bar.notice.kind] : null
  const current = bar.visible ? bar.notice : null

  return (
    <>
      {/* Header: context + inline resend, close button top-right. */}
      <div className="flex items-start gap-4 px-6 pt-6">
        <div className="min-w-0 flex-1 text-left">
          <DialogTitle className="font-heading mb-1.5 text-xl leading-tight font-bold tracking-tight">
            Anmelde-Code eingeben
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Wir haben dir einen 6-stelligen Anmelde-Code an{" "}
            <strong className="font-semibold text-foreground [overflow-wrap:anywhere]">
              {identifier}
            </strong>{" "}
            gesendet.{note && ` ${note}`}{" "}
            <button
              type="button"
              onClick={() => void resend()}
              disabled={busy || success}
              data-testid="checkin-code-resend"
              className="font-semibold text-cog-teal-dark underline underline-offset-[3px] transition-colors hover:text-foreground disabled:opacity-60"
            >
              Code erneut senden
            </button>
          </DialogDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Schliessen"
          className="-mt-1 -mr-1 flex size-8 flex-none items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <form onSubmit={submit}>
        {/* Code entry: six equal boxes that shrink evenly on phones. */}
        <div className="px-6 pt-[22px]">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={(next: string) => {
              setCode(next.replace(/\D/g, ""))
              hideNotice()
            }}
            disabled={busy || success}
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            containerClassName="w-full"
            aria-label="6-stelliger Code"
            data-testid="checkin-code-input"
          >
            <InputOTPGroup className="w-full gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="font-body h-14 min-w-0 flex-1 rounded-lg text-2xl font-semibold transition-[border-color,box-shadow] duration-150 data-[active=true]:border-cog-teal data-[active=true]:ring-[3px] data-[active=true]:ring-cog-teal/50"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        {/* Notice bar: full-bleed, animated height. The 24px top margin is
            the inputs→footer gap even while collapsed. */}
        <div
          aria-hidden={!current}
          className={cn(
            "mt-6 overflow-hidden [transition:max-height_220ms_cubic-bezier(0.4,0,0.2,1),opacity_180ms_ease] motion-reduce:transition-none",
            current ? "max-h-20 opacity-100" : "max-h-0 opacity-0",
          )}
        >
          <div
            role={style?.role ?? "status"}
            data-testid={
              current?.kind === "error"
                ? "checkin-code-error"
                : "checkin-code-notice"
            }
            className={cn(
              "flex items-center gap-2.5 px-6 py-[11px] text-[13px] leading-[1.4] transition-colors duration-[180ms] motion-reduce:transition-none",
              style?.className,
            )}
          >
            {style && <style.Icon className="size-4 flex-none" aria-hidden />}
            <span>{bar.notice?.text}</span>
          </div>
        </div>

        {/* Footer: full-bleed, primary action right-most. */}
        <div className="flex items-center justify-end gap-2 border-t bg-sidebar px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={busy}
            data-testid="checkin-code-cancel"
            className="rounded-lg px-5 hover:bg-muted hover:text-foreground"
          >
            Abbrechen
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={!canSubmit}
            data-testid="checkin-code-submit"
            className="rounded-lg bg-cog-teal-dark px-[22px] font-semibold text-white transition-[filter] duration-150 hover:bg-cog-teal-dark hover:brightness-[0.92] disabled:bg-cog-teal-dark/50 disabled:opacity-100"
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {success ? "Angemeldet" : submitLabel}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </form>
    </>
  )
}
