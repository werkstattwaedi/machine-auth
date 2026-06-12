// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #422: family quick-add chips must appear for a kiosk tag-tap
 * session, not only a logged-in account. `buildFamilyCandidates` is the
 * pure roster-assembly helper behind the wizard's `familyCandidates`
 * memo; these tests pin that a tag-identified principal surfaces the same
 * self + co-member chips a logged-in owner does, while the logged-in path
 * stays unchanged.
 */

import { describe, expect, it } from "vitest"
import type { UserDoc } from "@modules/lib/auth"
import type { TokenUser } from "@modules/lib/token-auth"
import { buildFamilyCandidates } from "./wizard-context"

const aliceDoc: UserDoc = {
  id: "alice",
  name: "Alice A",
  firstName: "Alice",
  lastName: "A",
  email: "alice@example.com",
  phone: null,
  roles: [],
  permissions: [],
  userType: "erwachsen",
  termsAcceptedAt: null,
  activeMembership: "m1",
}

const aliceToken: TokenUser = {
  tokenId: "tok-alice",
  userId: "alice",
  firstName: "Alice",
  lastName: "A",
  email: "alice@example.com",
  userType: "erwachsen",
  activeMembership: true,
}

const coMembers = [
  {
    id: "bob",
    firstName: "Bob",
    lastName: "B",
    email: "bob@example.com",
    userType: "kind",
  },
]

describe("buildFamilyCandidates", () => {
  it("logged-in owner: prepends self, then co-members", () => {
    const result = buildFamilyCandidates({
      familyMemberDocs: coMembers,
      claimedUserIds: new Set(),
      identifiedUserDoc: aliceDoc,
      tokenUser: null,
      hasFamilyMembership: true,
    })
    expect(result.map((c) => c.userId)).toEqual(["alice", "bob"])
    expect(result[1]).toMatchObject({ firstName: "Bob", userType: "kind" })
  })

  it("tag-tap session: surfaces self (from tokenUser) + co-members (#422)", () => {
    const result = buildFamilyCandidates({
      familyMemberDocs: coMembers,
      claimedUserIds: new Set(),
      // identifiedUserDoc is null for a tag-tap session — self must come
      // from tokenUser instead.
      identifiedUserDoc: null,
      tokenUser: aliceToken,
      hasFamilyMembership: true,
    })
    expect(result.map((c) => c.userId)).toEqual(["alice", "bob"])
    expect(result[0]).toMatchObject({
      userId: "alice",
      firstName: "Alice",
      email: "alice@example.com",
    })
  })

  it("filters out already-claimed members (self + co-member)", () => {
    const result = buildFamilyCandidates({
      familyMemberDocs: coMembers,
      claimedUserIds: new Set(["alice", "bob"]),
      identifiedUserDoc: null,
      tokenUser: aliceToken,
      hasFamilyMembership: true,
    })
    expect(result).toHaveLength(0)
  })

  it("returns no self chip when there is no family membership", () => {
    const result = buildFamilyCandidates({
      familyMemberDocs: [],
      claimedUserIds: new Set(),
      identifiedUserDoc: null,
      tokenUser: aliceToken,
      hasFamilyMembership: false,
    })
    expect(result).toHaveLength(0)
  })

  it("returns empty for an anonymous principal (no doc, no token)", () => {
    const result = buildFamilyCandidates({
      familyMemberDocs: [],
      claimedUserIds: new Set(),
      identifiedUserDoc: null,
      tokenUser: null,
      hasFamilyMembership: true,
    })
    expect(result).toHaveLength(0)
  })

  // ADR-0029: only account-less family members are rosterable. Co-members
  // with their own login (non-empty email) surface as disabled chips
  // (hasAccount: true); the identified principal is the allowed exception.
  describe("hasAccount flag (ADR-0029)", () => {
    const accountlessChild = {
      id: "kim",
      firstName: "Kim",
      lastName: "K",
      email: null,
      userType: "kind",
    }
    const adultWithAccount = {
      id: "dora",
      firstName: "Dora",
      lastName: "D",
      email: "dora@example.com",
      userType: "erwachsen",
    }

    it("marks co-members with an email as account-holders", () => {
      const result = buildFamilyCandidates({
        familyMemberDocs: [accountlessChild, adultWithAccount],
        claimedUserIds: new Set(),
        identifiedUserDoc: aliceDoc,
        tokenUser: null,
        hasFamilyMembership: true,
      })
      expect(result.map((c) => [c.userId, c.hasAccount])).toEqual([
        ["alice", false], // self — owner exception, despite having an email
        ["kim", false], // account-less child — rosterable
        ["dora", true], // own login — disabled chip
      ])
    })

    it("never marks the tag-tap self chip even though badge holders have accounts", () => {
      const result = buildFamilyCandidates({
        familyMemberDocs: [],
        claimedUserIds: new Set(),
        identifiedUserDoc: null,
        tokenUser: aliceToken,
        hasFamilyMembership: true,
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ userId: "alice", hasAccount: false })
    })
  })
})
