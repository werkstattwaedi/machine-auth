// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { ReactNode } from "react"
import { ExternalLink, X } from "lucide-react"
import { useBridge } from "@modules/lib/use-bridge"
import { HELP_URL, WHATS_NEW_URL } from "@/lib/help-links"
import { useWizardContext } from "./wizard-context"

/** Value of the `from` search param the old checkout redirects with. */
export const LEGACY_REDIRECT_FROM = "legacy"

/**
 * Announcement strip above the header for visitors the old checkout forwards
 * here (`?from=legacy`), pointing them at what changed. It lives in the URL
 * only: the next wizard step drops the parameter, and "Schliessen" strips it
 * in place. Never on the kiosk — nobody arrives there from the old checkout,
 * and a stray parameter must not greet the next visitor at the shared
 * terminal.
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
      // A deeper teal than cog-teal-dark: white text needs the contrast.
      className="w-full shrink-0 bg-[#1f7178] text-white"
    >
      <div className="mx-auto flex w-full max-w-[1000px] items-start gap-3 px-4 py-2.5 text-sm sm:items-center sm:px-6 sm:py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <span className="basis-full font-bold sm:basis-auto">
            Willkommen im neuen Self-Checkout
          </span>
          <span aria-hidden className="hidden opacity-50 sm:inline">
            ·
          </span>
          <ExternalTextLink href={WHATS_NEW_URL}>Was ist neu?</ExternalTextLink>
          <ExternalTextLink href={HELP_URL}>Anleitung</ExternalTextLink>
        </div>
        <button
          type="button"
          aria-label="Schliessen"
          onClick={onDismiss}
          className="-mr-1 shrink-0 rounded p-1 opacity-80 hover:bg-white/15 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-white"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

function ExternalTextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 whitespace-nowrap font-bold underline underline-offset-2 hover:opacity-85"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  )
}
