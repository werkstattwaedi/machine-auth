// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { StepCheckin } from "@/components/checkout/step-checkin"
import { useWizardContext } from "@/components/checkout/wizard-context"

export const Route = createFileRoute("/_wizard/checkin")({
  component: CheckinRoute,
})

function CheckinRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()

  return (
    <StepCheckin
      persons={ctx.persons}
      personsDispatch={ctx.personsDispatch}
      isAnonymous={ctx.isAnonymous}
      kiosk={ctx.kiosk}
      isAccountLoggedIn={ctx.isAccountLoggedIn}
      familyCandidates={ctx.familyCandidates}
      onSignOut={async () => {
        await ctx.signOut()
        // Full reload clears the wizard state — match the old wizard behavior.
        window.location.replace(ctx.kiosk ? "/checkin?kiosk" : "/checkin")
      }}
      onAdvance={async () => {
        // Issue #151: eager anonymous sign-in so /visit can write items.
        if (ctx.isAnonymous) await ctx.signInAnonymouslyIfNeeded()
        // Issue #246: persist the person roster onto the open checkout doc.
        await ctx.persistPersons()
        navigate({
          to: "/visit",
          search: ctx.kiosk ? { kiosk: "" } : {},
        })
      }}
    />
  )
}
