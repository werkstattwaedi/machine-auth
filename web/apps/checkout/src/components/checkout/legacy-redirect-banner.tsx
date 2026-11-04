// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react"
import { ExternalLink, Sparkles, X } from "lucide-react"
import { useBridge } from "@modules/lib/use-bridge"
import { cn } from "@modules/lib/utils"
import { HELP_URL, WHATS_NEW_URL } from "@/lib/help-links"
import { useWizardContext } from "./wizard-context"

/** Value of the `from` search param the old checkout redirects with. */
export const LEGACY_REDIRECT_FROM = "legacy"

/**
 * One-line notice for visitors the old checkout forwards here
 * (`?from=legacy`): a greeting and links to what changed and the Anleitung.
 * It lives in the URL only: the next wizard step drops the parameter, and
 * "Schliessen" strips it in place. Never on the kiosk — nobody arrives there
 * from the old checkout, and a stray parameter must not greet the next
 * visitor at the shared terminal.
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
      className="mb-6 flex items-start gap-3 rounded-md border border-cog-teal/40 bg-cog-teal/5 px-4 py-3 sm:items-center"
    >
      <Sparkles
        className="h-5 w-5 mt-0.5 shrink-0 text-cog-teal-dark sm:mt-0"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="basis-full font-bold sm:basis-auto">
          Willkommen beim neuen Self-Checkout
        </span>
        <Separator wideOnly />
        <ExternalTextLink href={WHATS_NEW_URL}>Was ist neu?</ExternalTextLink>
        <Separator />
        <ExternalTextLink href={HELP_URL}>Anleitung</ExternalTextLink>
      </div>
      <button
        type="button"
        aria-label="Schliessen"
        onClick={onDismiss}
        className="-mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-cog-teal-light hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

/** `wideOnly`: the one after the title, which takes its own line on a phone. */
function Separator({ wideOnly = false }: { wideOnly?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("text-muted-foreground", wideOnly && "hidden sm:inline")}
    >
      –
    </span>
  )
}

function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-bold text-cog-teal-dark underline underline-offset-2 hover:text-cog-teal"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  )
}
