// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { AlertTriangle, ArrowRight } from "lucide-react"
import {
  parseRejectionCause,
  rejectionCopy,
  type RejectionCause,
} from "@oww/shared"
import { useAuth } from "@modules/lib/auth"
import { Button } from "@modules/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@modules/components/ui/card"

/**
 * Generic "access denied" landing page (issue #535).
 *
 * A public page the MaCo links to via a QR code when it denies a machine
 * badge-in. It shows richer, per-cause copy than the terminal's one-liner —
 * keyed off the shared {@link RejectionCause} enum — plus an actionable path
 * for the stale-checkout case (close the open visit) and a warning when the
 * link was minted for a different signed-in account.
 *
 * Params (all optional):
 *   cause    — RejectionCause code (see @oww/shared); defaults to unspecified
 *   uid      — the user the link was minted for (mismatch warning)
 *   checkout — the offending open checkout id (stale_checkout only)
 *   since    — the checkout's creation date as YYYY-MM-DD (stale_checkout only)
 */
const deniedSearchSchema = z.object({
  cause: z.optional(z.string()),
  uid: z.optional(z.string()),
  checkout: z.optional(z.string()),
  since: z.optional(z.string()),
})

export const Route = createFileRoute("/denied")({
  validateSearch: deniedSearchSchema,
  component: DeniedPage,
})

/** Format a `YYYY-MM-DD` key as a de-CH `DD.MM.YYYY` display date. */
function formatSince(since: string | undefined): string | undefined {
  if (!since) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since)
  if (!match) return undefined
  const [, y, m, d] = match
  return `${d}.${m}.${y}`
}

function DeniedPage() {
  const navigate = useNavigate()
  const { cause, uid, since } = Route.useSearch()
  const { userDoc, sessionKind } = useAuth()

  const resolvedCause: RejectionCause = parseRejectionCause(cause)
  const copy = rejectionCopy(resolvedCause, { date: formatSince(since) })
  const isStale = resolvedCause === "stale_checkout"

  // Warn when a signed-in real user does not match the uid the link was minted
  // for — e.g. someone scans a colleague's terminal QR while logged into their
  // own account. Only meaningful for a real (email) session with a loaded doc.
  const isSignedIn = sessionKind === "real" && !!userDoc
  const mismatch = isSignedIn && !!uid && userDoc.id !== uid

  const handlePrimary = () => {
    // Reuse the existing flow: the root dispatcher forwards a signed-in user
    // with a stale open checkout to the checkout wizard. A guest is sent to
    // sign in first.
    if (isSignedIn && !mismatch) {
      navigate({ to: "/" })
    } else {
      navigate({ to: "/login", search: { redirect: "/" } })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{copy.heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">{copy.body}</p>

          {mismatch && (
            <div className="flex items-start gap-3 rounded-md border border-[#cc2a24]/50 bg-[#fce4e4] px-4 py-3 text-[#7a1a16]">
              <AlertTriangle
                className="h-5 w-5 mt-0.5 shrink-0 text-[#cc2a24]"
                aria-hidden
              />
              <p className="text-sm">
                Dieser Link gehört zu einem anderen Konto. Du bist mit einem
                anderen Benutzer angemeldet.
              </p>
            </div>
          )}

          {isStale && (
            <div className="space-y-2 pt-2">
              <Button className="w-full" onClick={handlePrimary}>
                Offenen Besuch abschliessen
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Du kannst deinen Besuch auch direkt am Terminal abschliessen.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
