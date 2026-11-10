// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCallback } from "react"
import { maskEmail } from "@oww/shared"
import { useAuth } from "@modules/lib/auth"

/**
 * How an e-mail address may be shown to whoever is at the screen. A kiosk
 * badge session without a code (ADR-0041) belongs to whoever holds the
 * badge — a found one must not reveal the owner's address — so it gets the
 * step-up dialog's masked form (`ma•••@ex•••.com`, ACC-8). Every other
 * session sees it in full.
 */
export function useShownEmail(): (email: string) => string {
  const { sessionKind, isKioskElevated } = useAuth()
  const mask = sessionKind === "tag" && !isKioskElevated
  return useCallback(
    (email: string) => (mask && email ? maskEmail(email) : email),
    [mask],
  )
}
