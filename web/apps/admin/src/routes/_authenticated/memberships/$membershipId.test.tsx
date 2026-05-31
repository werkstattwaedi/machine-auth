// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #323: the admin membership detail page can
 * end a membership's annual auto-renewal. The button calls the
 * `cancelMembershipAutoRenew` callable; success surfaces a German toast and
 * failure surfaces a German error toast (via useAsyncMutation).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode } from "react"

// ── Mocks ──────────────────────────────────────────────────────────────

const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

// The membership callables now go through the grouped `rpcCallable` client;
// the returned callable's resolution is controlled per-test via `mockCallable`.
// `useAsyncMutation` also fires a fire-and-forget `logClientError` callable
// (still a standalone `httpsCallable`) on failure — route that to a resolved
// no-op so it doesn't consume `mockCallable` invocations.
const mockCallable = vi.fn()
vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: (_functions: unknown, name: string) =>
    name === "logClientError"
      ? () => Promise.resolve({ data: { ok: true } })
      : (...args: unknown[]) => mockCallable(...args),
}))
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable:
    (_functions: unknown, _group: string, _method: string) =>
    (...args: unknown[]) =>
      mockCallable(...args),
}))

let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return {
      ...opts,
      useParams: () => ({ membershipId: "m1" }),
    }
  },
  Link: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...(props as Record<string, string>)}>{children}</a>
  ),
}))

vi.mock("@/components/admin/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

const mockUseDocument = vi.fn()
const mockUseCollection = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useDocument: (ref: unknown) => mockUseDocument(ref),
  useCollection: (...args: unknown[]) => mockUseCollection(...args),
}))

vi.mock("@modules/lib/firestore-helpers", () => ({
  membershipRef: (_db: unknown, id: string) => ({ id, path: `memberships/${id}` }),
  membershipInvitesCollection: (_db: unknown, id: string) => ({
    path: `memberships/${id}/invites`,
  }),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
}))

vi.mock("@modules/components/page-loading", () => ({
  PageLoading: () => <div>Lädt...</div>,
}))
vi.mock("@modules/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@modules/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock("@modules/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

// confirm() is called before the cancel callable fires.
vi.stubGlobal("confirm", () => true)

await import("./$membershipId")

function setupActiveMembership() {
  const membershipResult = {
    data: {
      id: "m1",
      type: "single",
      status: "active",
      ownerUserId: { id: "owner-1" },
      members: [{ id: "owner-1" }],
      validUntil: { toMillis: () => Date.now() + 1000, toDate: () => new Date() },
      lastPaidAt: { toMillis: () => Date.now(), toDate: () => new Date() },
      autoRenew: true,
    },
    loading: false,
    error: null,
  }
  mockUseDocument.mockReturnValue(membershipResult)
  mockUseCollection.mockReturnValue({ data: [], loading: false, error: null })
}

describe("MembershipDetailPage cancel auto-renew (issue #323)", () => {
  beforeEach(() => {
    mockCallable.mockReset()
    mockCallable.mockResolvedValue({ data: { ok: true } })
    mockToastError.mockReset()
    mockToastSuccess.mockReset()
    setupActiveMembership()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("calls cancelMembershipAutoRenew and surfaces a success toast", async () => {
    const Component = CapturedComponent!
    render(<Component />)

    const user = userEvent.setup()
    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: /Auto-Verlängerung beenden/ }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockCallable).toHaveBeenCalledTimes(1)
    expect(mockCallable).toHaveBeenCalledWith({ membershipId: "m1" })
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Automatische Verlängerung beendet",
    )
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("surfaces a German error toast when the callable rejects", async () => {
    mockCallable.mockRejectedValueOnce(new Error("callable rejected"))

    const Component = CapturedComponent!
    render(<Component />)

    const user = userEvent.setup()
    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: /Auto-Verlängerung beenden/ }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockCallable).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalledWith(
      "Verlängerung konnte nicht beendet werden",
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
