// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@modules/components/ui/button"
import { useWizardContext } from "./wizard-context"

/**
 * Full-screen feedback for a badge tap. The physical NFC read is near-
 * instant, but the subsequent verify RPC + Firebase custom-token sign-in
 * take seconds — without this overlay the kiosk showed nothing until the
 * person card silently pre-filled, so users assumed the tap was ignored
 * and tapped again (burning the SDM counter on a replay-rejected verify).
 *
 * Two states, both blocking:
 *   - verifying (`tagAuthLoading`): spinner, auto-dismissed by the hook.
 *   - failed (`tagAuthError`): error card with a close button. Dismissal
 *     is keyed on `picc` — each physical tap mints a fresh picc, so a new
 *     tap after dismissing surfaces a new failure again, while re-renders
 *     of the same failed tap stay dismissed.
 */
export function TagAuthOverlay() {
  const { tagAuthLoading, tagAuthError, picc } = useWizardContext()
  const [dismissedPicc, setDismissedPicc] = useState<string | null>(null)

  const showError = !!tagAuthError && !!picc && picc !== dismissedPicc
  if (!tagAuthLoading && !showError) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role={tagAuthLoading ? "status" : "alertdialog"}
      aria-modal={tagAuthLoading ? undefined : true}
      aria-label={
        tagAuthLoading ? undefined : "Badge konnte nicht gelesen werden"
      }
      aria-live="assertive"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg bg-background p-8 text-center shadow-lg">
        {tagAuthLoading ? (
          <>
            <Loader2
              className="h-12 w-12 animate-spin text-cog-teal-dark"
              aria-hidden
            />
            <div className="text-lg font-bold">Badge erkannt</div>
            <p className="text-sm text-muted-foreground">
              Deine Daten werden geladen — einen Moment bitte …
            </p>
          </>
        ) : (
          <>
            <AlertTriangle
              className="h-12 w-12 text-[#cc2a24]"
              aria-hidden
            />
            <div className="text-lg font-bold">
              Badge konnte nicht gelesen werden
            </div>
            <p className="text-sm text-muted-foreground">
              Bitte lege den Badge nochmals auf. Falls das Problem bestehen
              bleibt, melde dich beim Werkstatt-Team.
            </p>
            {/* Raw error for staff debugging — server messages may be
                technical/English, hence the generic headline above. */}
            <p className="break-words text-xs text-muted-foreground/70">
              {tagAuthError}
            </p>
            <Button onClick={() => setDismissedPicc(picc ?? null)}>
              Schliessen
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
