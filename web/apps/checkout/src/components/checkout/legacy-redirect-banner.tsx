// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react"
import { ExternalLink, Sparkles, X } from "lucide-react"
import { useBridge } from "@modules/lib/use-bridge"
import { HELP_URL, WHATS_NEW_URL } from "@/lib/help-links"
import { useWizardContext } from "./wizard-context"

/** Value of the `from` search param the old checkout redirects with. */
export const LEGACY_REDIRECT_FROM = "legacy"

/**
 * Greets visitors the old checkout forwards here (`?from=legacy`) and points
 * them at what changed. It lives in the URL only: the next wizard step drops
 * the parameter, and "Schliessen" strips it in place. Never on the kiosk —
 * nobody arrives there from the old checkout, and a stray parameter must not
 * greet the next visitor at the shared terminal.
 */
export function LegacyRedirectBanner({
  from,
  onDismiss,
}: {
  from: string | undefined
  onDismiss: () => void
}) {
  const { kiosk } = useWizardContext()
  const { available: bridgeAvailable } = useBridge()
  if (from !== LEGACY_REDIRECT_FROM || kiosk || bridgeAvailable) return null

  return (
    <div
      role="status"
      data-testid="legacy-redirect-banner"
      className="mb-6 flex items-start gap-3 rounded-md border border-cog-teal/40 bg-cog-teal/5 px-4 py-3"
    >
      <Sparkles className="h-5 w-5 mt-0.5 shrink-0 text-cog-teal-dark" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-bold">Willkommen im neuen Checkout</div>
        <p className="mt-0.5 text-sm">
          Der alte Checkout wurde durch diesen ersetzt. Einiges funktioniert
          jetzt anders.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-bold">
          <ExternalTextLink href={WHATS_NEW_URL}>Was ist neu?</ExternalTextLink>
          <ExternalTextLink href={HELP_URL}>Anleitung</ExternalTextLink>
        </div>
      </div>
      <button
        type="button"
        aria-label="Schliessen"
        onClick={onDismiss}
        className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-cog-teal-light hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-cog-teal-dark underline underline-offset-2 hover:text-cog-teal"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  )
}
