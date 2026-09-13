// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk entry points into the member area (ADR-0041): "Konto verwalten" and,
 * for non-members, "Mitglied werden". Rendered under the identified
 * visitor's "Deine Angaben" block on the kiosk. A badge-tap session goes
 * through the step-up dialog first (useKioskElevation); a session that is
 * already elevated (code sign-in, or stepped up earlier) navigates straight
 * away. Renders nothing for anonymous visitors and outside a kiosk session.
 */

import { useNavigate } from "@tanstack/react-router"
import { BadgeCheck, UserCog } from "lucide-react"
import { useAuth } from "@modules/lib/auth"
import { useKioskElevation } from "./kiosk-elevation-dialog"
import { useWizardContext } from "./wizard-context"

const ACTION =
  "inline-flex h-[42px] items-center gap-2 rounded-md border border-cog-teal bg-white px-4 text-[15px] font-semibold text-cog-teal-dark transition-colors hover:bg-cog-teal-light"

export function KioskAccountActions() {
  const { sessionKind } = useAuth()
  const { kiosk, isAnonymous, isMember } = useWizardContext()
  const { ensureElevated } = useKioskElevation()
  const navigate = useNavigate()

  if (!kiosk || isAnonymous || sessionKind !== "tag") return null

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-3"
      data-testid="kiosk-account-actions"
    >
      {!isMember && (
        <button
          type="button"
          className={ACTION}
          data-testid="kiosk-become-member"
          onClick={() =>
            ensureElevated(() => navigate({ to: "/account/membership" }))
          }
        >
          <BadgeCheck className="h-4 w-4" aria-hidden />
          Mitglied werden
        </button>
      )}
      <button
        type="button"
        className={ACTION}
        data-testid="kiosk-manage-account"
        onClick={() => ensureElevated(() => navigate({ to: "/account/usage" }))}
      >
        <UserCog className="h-4 w-4" aria-hidden />
        Konto verwalten
      </button>
    </div>
  )
}
