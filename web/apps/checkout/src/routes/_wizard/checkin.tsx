// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { QrCode } from "lucide-react"
import { StepCheckin } from "@/components/checkout/step-checkin"
import { VisitStartedDialog } from "@/components/checkout/visit-started-dialog"
import { useWizardContext } from "@/components/checkout/wizard-context"

export const Route = createFileRoute("/_wizard/checkin")({
  component: CheckinRoute,
})

function CheckinRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()
  const search = useSearch({ from: "/_wizard" })
  const rescan = search.rescan === "1"
  // Kiosk "Besuch starten": the checkout doc is written, the confirmation
  // dialog shows and then resets the terminal for the next person.
  const [visitStarted, setVisitStarted] = useState(false)

  return (
    <>
      {rescan && (
        <div className="mb-6 flex items-start gap-3 rounded-md border border-cog-teal/40 bg-cog-teal/5 px-4 py-3">
          <QrCode className="h-5 w-5 mt-0.5 shrink-0 text-cog-teal-dark" aria-hidden />
          <p className="text-sm text-foreground">
            Bitte zuerst einchecken — danach den QR-Code nochmals scannen,
            um das Material hinzuzufügen.
          </p>
        </div>
      )}
      <StepCheckin
      persons={ctx.persons}
      personsDispatch={ctx.personsDispatch}
      isAnonymous={ctx.isAnonymous}
      kiosk={ctx.kiosk}
      isAccountLoggedIn={ctx.isAccountLoggedIn}
      signedInUserId={ctx.identifiedUserDoc?.id ?? null}
      signedInEmail={ctx.identifiedUserDoc?.email ?? null}
      isMember={ctx.isMember}
      familyCandidates={ctx.familyCandidates}
      // Kiosk: badge-tap progress/errors render inside the NFC affordance
      // box on this page (TagAuthOverlay stays home for browser tag taps).
      tagAuthLoading={ctx.tagAuthLoading}
      tagAuthError={ctx.tagAuthError}
      picc={ctx.picc}
      // Signed-in "Abmelden" and the anon "Von vorne beginnen" share one
      // primitive: drop the session + hard-reload to a fresh /checkin.
      onSignOut={ctx.startOver}
      onAdvance={async () => {
        // Issue #151: eager anonymous sign-in so /visit can write items.
        if (ctx.isAnonymous) await ctx.signInAnonymouslyIfNeeded()
        try {
          // Issue #246: persist the person roster onto the open checkout doc.
          await ctx.persistPersons()
        } catch {
          // persistPersons already toasted (ADR-0025) and re-threw; stay on
          // /checkin so the user can retry instead of bouncing to the
          // no-checkout gate on /visit.
          return
        }
        navigate({
          to: "/visit",
          search: ctx.kiosk ? { kiosk: "" } : {},
        })
      }}
      // Kiosk primary action: check in (create the checkout) WITHOUT
      // navigating to /visit — the visitor is done at the terminal. The
      // confirmation dialog below then frees the kiosk via startOver.
      onStartVisit={
        ctx.kiosk
          ? async () => {
              if (ctx.isAnonymous) await ctx.signInAnonymouslyIfNeeded()
              try {
                await ctx.persistPersons()
              } catch {
                // persistPersons already toasted (ADR-0025); stay on
                // /checkin so the user can retry.
                return
              }
              setVisitStarted(true)
            }
          : undefined
      }
    />
    <VisitStartedDialog
      open={visitStarted}
      onDone={() => void ctx.startOver()}
    />
    </>
  )
}
