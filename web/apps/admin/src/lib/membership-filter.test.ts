// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { Timestamp } from "firebase/firestore"
import {
  membershipFilterStatus,
  EXPIRING_SOON_DAYS,
} from "./membership-filter"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-07-05T12:00:00Z")

function membership(status: string, validInDays: number) {
  return { status, validUntil: Timestamp.fromMillis(NOW + validInDays * DAY) }
}

describe("membershipFilterStatus", () => {
  it("buckets by status and remaining validity", () => {
    expect(membershipFilterStatus(null, NOW)).toBe("none")
    expect(membershipFilterStatus(membership("active", 200), NOW)).toBe("active")
    expect(
      membershipFilterStatus(membership("active", EXPIRING_SOON_DAYS - 1), NOW),
    ).toBe("expiring")
    expect(membershipFilterStatus(membership("active", -1), NOW)).toBe("expired")
    expect(membershipFilterStatus(membership("expired", -30), NOW)).toBe("expired")
    expect(membershipFilterStatus(membership("cancelled", 100), NOW)).toBe(
      "expired",
    )
  })
})
