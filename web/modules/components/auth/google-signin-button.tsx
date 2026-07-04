// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import { GoogleIcon } from "@modules/components/icons/google"
import { cn } from "@modules/lib/utils"

export interface GoogleSignInButtonProps {
  /**
   * Google verified the e-mail but no completed account exists yet — the
   * host decides where the sign-up form lives (inline stage on /login,
   * dialog on /checkin). Name parts come from the Google profile.
   */
  onNewAccount: (name: { firstName: string; lastName: string }) => void
  /**
   * The e-mail already has a code-based account that must be linked first
   * (`auth/account-exists-with-different-credential`). Hosts surface their
   * own "sign in by code to link Google" hint.
   */
  onLinkHint: () => void
  className?: string
}

/**
 * The "Mit Google anmelden" button with its full error handling, shared by
 * the /login page and the embedded check-in sign-in. An existing account
 * simply signs in (the host reacts to the auth-state change); a new one is
 * reported via `onNewAccount`.
 */
export function GoogleSignInButton({
  onNewAccount,
  onLinkHint,
  className,
}: GoogleSignInButtonProps) {
  const { signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    setBusy(true)
    try {
      const { isNewAccount, firstName, lastName } = await signInWithGoogle()
      if (isNewAccount) onNewAccount({ firstName, lastName })
      // Existing account → the host's auth-state handling takes over.
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? (err as { code: string }).code
          : undefined
      if (code === "auth/account-exists-with-different-credential") {
        onLinkHint()
        toast.info("Bitte zuerst per E-Mail-Code anmelden")
      } else if (code === "auth/popup-closed-by-user") {
        // User closed the popup — no error needed.
      } else {
        const message = err instanceof Error ? err.message : "Fehler"
        toast.error(`Anmeldung fehlgeschlagen: ${message}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      onClick={handleClick}
      className={cn(
        "w-full h-11 text-[15px] bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-semibold shadow-xs",
        className,
      )}
      disabled={busy}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : (
        <GoogleIcon className="h-4 w-4 mr-2" />
      )}
      Mit Google anmelden
    </Button>
  )
}
