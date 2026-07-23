// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Fallback route for the member-area gate (_authenticated.tsx): an unclaimed
// member who navigates straight to a member page is redirected here. The
// primary path shows the same onboarding as an overlay on the live checkout
// (see _wizard.tsx / WelcomeOnboarding). On completion we return to wherever
// the member was headed (?redirect=) or the root dispatcher.

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod/v4/mini"
import { WelcomeOnboarding } from "@/components/account/welcome-onboarding"

const completeProfileSearchSchema = z.object({
  redirect: z.optional(z.string()),
})

export const Route = createFileRoute("/_authonly/account/complete-profile")({
  validateSearch: completeProfileSearchSchema,
  component: CompleteProfilePage,
})

function CompleteProfilePage() {
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()
  return (
    <WelcomeOnboarding
      onDone={() => navigate({ to: redirectTo || "/" })}
    />
  )
}
