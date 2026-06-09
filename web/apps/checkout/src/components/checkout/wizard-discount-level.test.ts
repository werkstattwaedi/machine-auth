// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression cover for issue #358: tag-auth members were charged non-member
 * item prices because `discountLevel` was derived only from the logged-in
 * account doc. For a tag tap `identifiedUserDoc` is null, so member pricing
 * must fall through to the server-derived `tokenUser.activeMembership` flag.
 */

import { describe, expect, it } from "vitest"
import type { UserDoc } from "@modules/lib/auth"
import type { TokenUser } from "@modules/lib/token-auth"
import { deriveDiscountLevel, deriveIsMember } from "./wizard-context"

const baseUserDoc: UserDoc = {
  id: "u-self",
  name: "Max Muster",
  firstName: "Max",
  lastName: "Muster",
  email: "max@example.com",
  phone: null,
  roles: [],
  permissions: [],
  userType: "erwachsen",
  termsAcceptedAt: { toDate: () => new Date() } as never,
  activeMembership: null,
}

// The helper only checks truthiness of activeMembership, so a sentinel ref is fine.
const MEMBERSHIP_REF = { id: "m_2026" } as unknown as UserDoc["activeMembership"]

const tagUser = (activeMembership?: boolean): TokenUser => ({
  tokenId: "04c339aa1e1890",
  userId: "u-tag",
  firstName: "Tag",
  lastName: "User",
  activeMembership,
})

describe("deriveDiscountLevel", () => {
  it("charges the member tier for a logged-in member", () => {
    const member: UserDoc = { ...baseUserDoc, activeMembership: MEMBERSHIP_REF }
    expect(deriveDiscountLevel(member, null)).toBe("member")
  })

  it("charges the member tier for a tag-auth member (issue #358)", () => {
    // identifiedUserDoc is null for tag-tap; the tag user's server-derived
    // membership boolean must still drive member pricing.
    expect(deriveDiscountLevel(null, tagUser(true))).toBe("member")
  })

  it("charges no discount for a tag-auth non-member", () => {
    expect(deriveDiscountLevel(null, tagUser(false))).toBe("none")
  })

  it("charges no discount for a tag user with undefined membership", () => {
    expect(deriveDiscountLevel(null, tagUser(undefined))).toBe("none")
  })

  it("charges no discount when neither principal is a member", () => {
    expect(deriveDiscountLevel(baseUserDoc, null)).toBe("none")
  })

  it("charges no discount for a fully anonymous checkout", () => {
    expect(deriveDiscountLevel(null, null)).toBe("none")
  })
})

/**
 * Regression cover for issue #414: the Sammelrechnung payment tab and the
 * "Vereinsmitglied" check-in badge are gated on a membership flag. The
 * pre-fix call sites read `!!identifiedUserDoc?.activeMembership`, which is
 * always false for a tag tap (`identifiedUserDoc === null`), so a tag-tapping
 * member was offered neither. `deriveIsMember` ORs both principals so the
 * tag user's server-derived membership boolean is honoured.
 */
describe("deriveIsMember", () => {
  it("is a member for a logged-in member", () => {
    const member: UserDoc = { ...baseUserDoc, activeMembership: MEMBERSHIP_REF }
    expect(deriveIsMember(member, null)).toBe(true)
  })

  it("is a member for a tag-auth member (issue #414)", () => {
    // The failing case today: identifiedUserDoc is null for a tag tap, so the
    // old `!!identifiedUserDoc?.activeMembership` expression returned false and
    // hid the monthly-bill tab. The tag user's membership boolean must win.
    expect(deriveIsMember(null, tagUser(true))).toBe(true)
  })

  it("is not a member for a tag-auth non-member", () => {
    expect(deriveIsMember(null, tagUser(false))).toBe(false)
  })

  it("is not a member for a tag user with undefined membership", () => {
    expect(deriveIsMember(null, tagUser(undefined))).toBe(false)
  })

  it("is not a member when neither principal is a member", () => {
    expect(deriveIsMember(baseUserDoc, null)).toBe(false)
  })

  it("is not a member for a fully anonymous checkout", () => {
    expect(deriveIsMember(null, null)).toBe(false)
  })
})
