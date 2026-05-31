// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { AlertTriangle } from "lucide-react"
import { isCheckoutStale } from "@modules/lib/session-day"
import { useWizardContext } from "./wizard-context"

/**
 * Red/orange banner rendered across the wizard when the user's open
 * checkout predates today's 3:00 AM Europe/Zurich rollover. The banner
 * persists on /visit, /checkout and /payment — wherever the user is in
 * the wizard, they should be reminded that yesterday's visit needs to
 * be settled before machines unlock (server-side machine lock is a
 * follow-up).
 */
export function StaleCheckoutBanner() {
  const { openCheckout } = useWizardContext()
  if (!openCheckout) return null
  const created = (openCheckout.created as { toDate(): Date } | undefined)?.toDate()
  if (!created) return null
  if (!isCheckoutStale(created)) return null

  const dateLabel = created.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

  return (
    <div className="mb-6 flex items-start gap-3 rounded-md border border-[#cc2a24]/50 bg-[#fce4e4] px-4 py-3 text-[#7a1a16]">
      <AlertTriangle
        className="h-5 w-5 mt-0.5 shrink-0 text-[#cc2a24]"
        aria-hidden
      />
      <div className="min-w-0">
        <div className="font-bold">
          Offener Besuch vom {dateLabel}
        </div>
        <p className="mt-0.5 text-sm">
          Bitte schliesse diesen Besuch zuerst ab, bevor du Maschinen
          benutzt oder einen neuen Besuch startest.
        </p>
      </div>
    </div>
  )
}
