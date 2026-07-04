// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Verified self-service phone numbers for SMS login (ADR-0031).
 *
 * The profile's Telefon field stores a display copy on the users doc; SMS
 * login additionally requires the number to be LINKED to the Firebase Auth
 * account — that link is the verification (one SMS code), and Firebase
 * enforces one-account-per-phone globally. This block renders under the
 * Telefon field:
 *   - saved number linked        → confirmation line
 *   - saved number not linked    → "Für SMS-Anmeldung bestätigen" button
 *     (sends the code, confirms in the shared CodeEntryDialog, then links
 *     via linkWithCredential — or updatePhoneNumber when replacing a
 *     previously linked number)
 *   - no saved number / flag off → renders nothing
 */

import { useRef, useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react"
import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  updatePhoneNumber,
  type User,
} from "firebase/auth"
import { useFirebaseAuth } from "@modules/lib/firebase-context"
import { CodeEntryDialog, messageFromError } from "../checkout/code-entry-dialog"

function verificationErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  switch (code) {
    case "auth/invalid-verification-code":
      return "Code falsch."
    case "auth/code-expired":
      return "Der Code ist abgelaufen. Bitte fordere einen neuen an."
    case "auth/credential-already-in-use":
    case "auth/account-exists-with-different-credential":
      return "Diese Nummer ist bereits mit einem anderen Konto verknüpft."
    case "auth/requires-recent-login":
      return "Aus Sicherheitsgründen musst du dich zuerst neu anmelden."
    default:
      return messageFromError(err, "Bestätigung fehlgeschlagen. Bitte versuche es erneut.")
  }
}

export function PhoneVerification({
  user,
  /** The SAVED E.164 number from the users doc (not the form value). */
  savedPhone,
  /** True while the profile form has unsaved edits — verify the saved
   *  number only, so the button asks to save first. */
  formDirty,
}: {
  user: User | null
  savedPhone: string | null
  formDirty: boolean
}) {
  const auth = useFirebaseAuth()
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  // linkWithCredential mutates the same User object the auth context holds,
  // so mirror the linked number in state to get a re-render on success.
  const [linkedPhone, setLinkedPhone] = useState(user?.phoneNumber ?? null)
  const verificationIdRef = useRef<string | null>(null)
  const recaptchaHostRef = useRef<HTMLDivElement | null>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)

  if (!user || !savedPhone) return null
  const verified = linkedPhone === savedPhone

  const sendCode = async () => {
    const host = recaptchaHostRef.current
    if (!host) throw new Error("reCAPTCHA host not mounted")
    verifierRef.current?.clear()
    const slot = document.createElement("div")
    host.replaceChildren(slot)
    const verifier = new RecaptchaVerifier(auth, slot, { size: "invisible" })
    verifierRef.current = verifier
    verificationIdRef.current = await new PhoneAuthProvider(
      auth,
    ).verifyPhoneNumber(savedPhone, verifier)
  }

  const startVerification = async () => {
    setBusy(true)
    try {
      await sendCode()
      setDialogOpen(true)
    } catch (err) {
      toast.error(verificationErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const confirmCode = async (code: string) => {
    const verificationId = verificationIdRef.current
    if (!verificationId) {
      throw new Error("Kein Code aktiv — bitte fordere einen neuen Code an.")
    }
    const credential = PhoneAuthProvider.credential(verificationId, code)
    try {
      if (user.phoneNumber) {
        // Replacing a previously verified number.
        await updatePhoneNumber(user, credential)
      } else {
        await linkWithCredential(user, credential)
      }
    } catch (err) {
      throw new Error(verificationErrorMessage(err))
    }
    setLinkedPhone(savedPhone)
    setDialogOpen(false)
    toast.success("Handynummer bestätigt — SMS-Anmeldung ist aktiv.")
  }

  return (
    <div data-testid="phone-verification">
      <div ref={recaptchaHostRef} aria-hidden />
      {verified ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-cog-teal-dark">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Bestätigt — du kannst dich per SMS-Code anmelden.
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void startVerification()}
            disabled={busy || formDirty}
            data-testid="phone-verify-start"
            className="inline-flex items-center gap-1.5 rounded-md border border-cog-teal bg-white px-2.5 py-1.5 text-xs font-semibold text-cog-teal-dark transition-colors hover:bg-cog-teal-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            )}
            Für SMS-Anmeldung bestätigen
          </button>
          <span className="text-xs text-muted-foreground">
            {formDirty
              ? "Zuerst speichern, dann bestätigen."
              : "Erst nach der Bestätigung kannst du dich mit dieser Nummer anmelden."}
          </span>
        </div>
      )}

      <CodeEntryDialog
        open={dialogOpen}
        identifier={savedPhone}
        submitLabel="Bestätigen"
        onCancel={() => setDialogOpen(false)}
        onResend={async () => {
          await sendCode()
          toast.success("Neuer Code gesendet!")
        }}
        onVerify={async (_id, code) => confirmCode(code)}
      />
    </div>
  )
}
