// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #601: on the family roster card, the
 * pending invite's e-mail address rendered in `font-mono` while every
 * other text on the card uses the regular UI font. In the admin app the
 * monospace face is reserved for codes / IDs / bill references, so the
 * address must inherit the card's plain body font.
 *
 * Issue #622: the admin must not invite by e-mail (the invitation is
 * signed with the caller's name). The roster card offers two add paths
 * instead — an existing person (`adminAddFamilyMember`) or a login-less
 * one (`createManagedMember`) — and never calls `inviteFamilyMember`.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

// Records (functions, group, method) per call and the payload it was
// invoked with, so tests can assert which callable ran.
const mockRpcFn = vi.fn((_payload: unknown) => Promise.resolve({ data: {} }))
const mockRpcCallable = vi.fn(
  (_functions: unknown, _group: string, _method: string) => mockRpcFn,
)
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: (functions: unknown, group: string, method: string) =>
    mockRpcCallable(functions, group, method),
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

const allUsers = [
  { id: "u1", firstName: "Svenja", lastName: "Obrist", activeMembership: { id: "m1" } },
  { id: "u2", firstName: "Zora", lastName: "Frei", activeMembership: null },
  // Legacy doc without the field at all — still eligible.
  { id: "u3", firstName: "Anton", lastName: "Keller" },
  // Member elsewhere — the server would reject, so the picker hides them.
  { id: "u4", firstName: "Bea", lastName: "Anders", activeMembership: { id: "m9" } },
  // Login-less people stay eligible (re-adding a removed managed member).
  { id: "u5", firstName: "Mia", lastName: "Kind", email: null, activeMembership: null },
]

vi.mock("@modules/lib/firestore", () => ({
  useCollection: (ref: { path: string }) => ({
    data: ref.path === "users" ? allUsers : [pendingInvite],
    loading: false,
    error: null,
  }),
}))

vi.mock("@modules/lib/firestore-helpers", () => ({
  membershipInvitesCollection: (_db: unknown, id: string) => ({
    path: `memberships/${id}/invites`,
  }),
  usersCollection: () => ({ path: "users" }),
}))

// Radix Select needs pointer/layout APIs jsdom lacks; a native <select>
// keeps the `value` / `onValueChange` contract the component relies on.
vi.mock("@modules/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: ReactNode
  }) => (
    <select
      aria-label="Person"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

vi.mock("@modules/lib/lookup", () => ({
  useLookup: () => ({ users: new Map([["u1", "Svenja Obrist"]]) }),
  resolveRef: (map: Map<string, string>, ref: { id: string }) =>
    map.get(ref.id) ?? ref.id,
}))

// The real hook toasts and re-throws (ADR-0025); the mock just runs the
// function so the underlying rpc call is observable.
vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({
    mutate: (fn: () => Promise<unknown>) => fn(),
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

describe("PersonMembershipTab add member (issue #622)", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const renderTab = () =>
    render(
      <PersonMembershipTab
        userId="u1"
        user={owner}
        membership={familyMembership}
      />,
    )

  const calledMethods = () => mockRpcCallable.mock.calls.map((c) => c[2])

  it("offers no e-mail invite form", async () => {
    const user = userEvent.setup()
    renderTab()

    expect(screen.queryByText("Mitglied einladen")).toBeNull()
    expect(document.querySelector('input[type="email"]')).toBeNull()

    await user.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }))
    expect(document.querySelector('input[type="email"]')).toBeNull()
    await user.click(screen.getByRole("button", { name: "Ohne Login" }))
    expect(document.querySelector('input[type="email"]')).toBeNull()
    expect(calledMethods()).not.toContain("inviteFamilyMember")
  })

  it("lists only people without an active membership, sorted by name", async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }))

    const options = Array.from(
      screen.getByLabelText("Person").querySelectorAll("option"),
    )
      .map((o) => o.textContent)
      .filter(Boolean)
    expect(options).toEqual(["Anton Keller", "Mia Kind", "Zora Frei"])
  })

  it("adds an existing person via adminAddFamilyMember and collapses", async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }))

    const add = screen.getByRole("button", { name: "Hinzufügen" })
    expect((add as HTMLButtonElement).disabled).toBe(true)

    await user.selectOptions(screen.getByLabelText("Person"), "u2")
    await user.click(add)

    expect(mockRpcCallable).toHaveBeenCalledWith(
      expect.anything(),
      "membershipCall",
      "adminAddFamilyMember",
    )
    expect(mockRpcFn).toHaveBeenCalledWith({ membershipId: "m1", userId: "u2" })
    expect(calledMethods()).not.toContain("inviteFamilyMember")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mitglied hinzufügen" }),
      ).toBeTruthy(),
    )
  })

  it("keeps the form open when the add fails", async () => {
    mockRpcFn.mockRejectedValueOnce(new Error("failed-precondition"))
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }))
    await user.selectOptions(screen.getByLabelText("Person"), "u2")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))

    await waitFor(() => expect(mockRpcFn).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: "Mitglied hinzufügen" })).toBeNull()
    expect((screen.getByLabelText("Person") as HTMLSelectElement).value).toBe("u2")
  })

  it("creates a login-less person via createManagedMember", async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }))
    await user.click(screen.getByRole("button", { name: "Ohne Login" }))

    const submit = screen.getByRole("button", { name: "Person erstellen" })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByLabelText("Vorname"), " Mia ")
    await user.type(screen.getByLabelText("Nachname"), "Obrist")
    await user.click(screen.getByRole("button", { name: "Kind" }))
    await user.click(submit)

    expect(mockRpcCallable).toHaveBeenCalledWith(
      expect.anything(),
      "membershipCall",
      "createManagedMember",
    )
    expect(mockRpcFn).toHaveBeenCalledWith({
      membershipId: "m1",
      firstName: "Mia",
      lastName: "Obrist",
      userType: "kind",
    })
    expect(calledMethods()).not.toContain("inviteFamilyMember")
  })

  it("revokes a pending invite via revokeFamilyInvite", async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole("button", { name: "Zurückziehen" }))

    expect(mockRpcCallable).toHaveBeenCalledWith(
      expect.anything(),
      "membershipCall",
      "revokeFamilyInvite",
    )
    expect(mockRpcFn).toHaveBeenCalledWith({ membershipId: "m1", inviteId: "inv1" })
  })
})
