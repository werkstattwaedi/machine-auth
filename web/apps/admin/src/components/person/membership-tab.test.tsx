// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #601: on the family roster card, the
 * pending invite's e-mail address rendered in `font-mono` while every
 * other text on the card uses the regular UI font. In the admin app the
 * monospace face is reserved for codes / IDs / bill references, so the
 * address must inherit the card's plain body font.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"
import { type ReactNode } from "react"
import type {
  MembershipDoc,
  MembershipInviteDoc,
  UserDoc,
} from "@modules/lib/firestore-entities"

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
}))

vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: () => () => Promise.resolve({ data: {} }),
}))

const invitedAt = new Date("2026-08-25T20:23:00Z")
const pendingInvite: MembershipInviteDoc & { id: string } = {
  id: "inv1",
  email: "luca.becci@example.ch",
  status: "pending",
  invitedAt: { toDate: () => invitedAt },
  invitedBy: { id: "u1" },
  resolvedAt: null,
  ttlAt: { toDate: () => invitedAt },
} as unknown as MembershipInviteDoc & { id: string }

vi.mock("@modules/lib/firestore", () => ({
  useCollection: () => ({ data: [pendingInvite], loading: false, error: null }),
}))

vi.mock("@modules/lib/firestore-helpers", () => ({
  membershipInvitesCollection: (_db: unknown, id: string) => ({
    path: `memberships/${id}/invites`,
  }),
}))

vi.mock("@modules/lib/lookup", () => ({
  useLookup: () => ({ users: new Map([["u1", "Svenja Obrist"]]) }),
  resolveRef: (map: Map<string, string>, ref: { id: string }) =>
    map.get(ref.id) ?? ref.id,
}))

vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({
    mutate: vi.fn(() => Promise.resolve()),
    loading: false,
    error: null,
  }),
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...(props as Record<string, string>)}>{children}</a>
  ),
}))

const { PersonMembershipTab } = await import("./membership-tab")

const owner: UserDoc = {
  firstName: "Svenja",
  lastName: "Obrist",
  email: "svenja@example.ch",
  roles: [],
  permissions: [],
  userType: "erwachsen",
} as unknown as UserDoc

const familyMembership: MembershipDoc & { id: string } = {
  id: "m1",
  type: "family",
  status: "active",
  lastPaidAt: { toDate: () => new Date("2026-02-01T00:00:00Z") },
  validUntil: { toDate: () => new Date("2027-02-01T00:00:00Z") },
  ownerUserId: { id: "u1" },
  members: [{ id: "u1" }],
  paymentCheckouts: [],
  autoRenew: true,
} as unknown as MembershipDoc & { id: string }

describe("PersonMembershipTab open invites (issue #601)", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renders the invited e-mail in the regular UI font, not monospace", () => {
    render(
      <PersonMembershipTab
        userId="u1"
        user={owner}
        membership={familyMembership}
      />,
    )

    expect(screen.getByText("Offene Einladungen")).toBeTruthy()
    const email = screen.getByText("luca.becci@example.ch")
    expect(email.classList.contains("font-mono")).toBe(false)
    // The invitedAt suffix stays next to the address.
    expect(email.parentElement?.textContent).toMatch(/eingeladen /)
  })
})
