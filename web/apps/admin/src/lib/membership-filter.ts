// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { Timestamp } from "firebase/firestore"

/**
 * Membership bucket for the Personen list filter pills. "expiring" =
 * active but running out within {@link EXPIRING_SOON_DAYS} — aligned with
 * the renewal-invoicer horizon so the pill surfaces people whose renewal
 * is (about to be) in flight.
 */
export type MembershipFilterStatus = "active" | "expiring" | "expired" | "none"

export const EXPIRING_SOON_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export function membershipFilterStatus(
  membership: { status: string; validUntil: Timestamp } | null | undefined,
  nowMs: number,
): MembershipFilterStatus {
  if (!membership) return "none"
  if (membership.status !== "active") return "expired"
  const validUntilMs = membership.validUntil?.toMillis() ?? 0
  if (validUntilMs <= nowMs) return "expired"
  if (validUntilMs - nowMs <= EXPIRING_SOON_DAYS * DAY_MS) return "expiring"
  return "active"
}
