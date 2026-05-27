// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { QrCode } from "lucide-react"
import { StepCheckin } from "@/components/checkout/step-checkin"
import { useWizardContext } from "@/components/checkout/wizard-context"

export const Route = createFileRoute("/_wizard/checkin")({
  component: CheckinRoute,
})

function CheckinRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()
  const search = useSearch({ from: "/_wizard" })
  const rescan = search.rescan === "1"

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
      isMember={!!ctx.identifiedUserDoc?.activeMembership}
      familyCandidates={ctx.familyCandidates}
      onSignOut={async () => {
        await ctx.signOut()
        // Full reload clears the wizard state — match the old wizard behavior.
        window.location.replace(ctx.kiosk ? "/checkin?kiosk" : "/checkin")
      }}
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
    />
    </>
  )
}
