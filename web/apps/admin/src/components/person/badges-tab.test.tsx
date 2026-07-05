// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #182: the admin tag operations
 * (`handleAddTag`, `handleToggleTag`) route through `useAsyncMutation`.
 * A rejection MUST surface a German error toast (silent before); a
 * success MUST surface a German confirmation toast. Ported from the old
 * user-detail route test after the tags UI moved to the Badges tab.
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
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => () => Promise.resolve({ data: { ok: true } }),
}))

const mockUseCollection = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useCollection: (...args: unknown[]) => mockUseCollection(...args),
}))

vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: (_db: unknown, id: string) => ({ id, path: `users/${id}` }),
  tokenRef: (_db: unknown, id: string) => ({ id, path: `tokens/${id}` }),
  tokensCollection: (_db: unknown) => ({ path: "tokens" }),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
}))

const mockSet = vi.fn()
const mockUpdate = vi.fn()
vi.mock("@modules/hooks/use-firestore-mutation", () => ({
  useFirestoreMutation: () => ({
    add: vi.fn(),
    update: mockUpdate,
    remove: vi.fn(),
    set: mockSet,
    mutate: vi.fn(),
    loading: false,
    error: null,
  }),
}))

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>()
  return {
    ...actual,
    serverTimestamp: () => "server-ts",
    where: () => ({}),
  }
})

vi.mock("@modules/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@modules/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock("@modules/components/ui/table", () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
}))
vi.mock("@modules/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    type?: "submit" | "button"
  }) => (
    <button onClick={onClick} disabled={disabled} type={type ?? "button"}>
      {children}
    </button>
  ),
}))
vi.mock("@modules/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => (
    <input {...(props as React.InputHTMLAttributes<HTMLInputElement>)} />
  ),
}))
vi.mock("@modules/components/page-loading", () => ({
  PageLoading: () => <div>Lädt...</div>,
}))
vi.mock("@/nfc/use-tag-scan", () => ({
  useTagScan: () => ({ supported: false, scanTag: vi.fn() }),
}))

const { PersonBadgesTab } = await import("./badges-tab")

function setupDefaults() {
  const tokensResult = {
    data: [
      {
        id: "tag-1",
        label: "",
        registered: { toDate: () => new Date(0) },
        deactivated: null,
      },
    ],
    loading: false,
    error: null,
  }
  mockUseCollection.mockReturnValue(tokensResult)
}

describe("PersonBadgesTab tag operations error envelope (issue #182)", () => {
  beforeEach(() => {
    mockSet.mockReset()
    mockUpdate.mockReset()
    mockToastError.mockReset()
    mockToastSuccess.mockReset()
    setupDefaults()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("handleAddTag: failure surfaces German error toast (was silent before #182)", async () => {
    mockSet.mockRejectedValueOnce(new Error("set rejected"))

    render(<PersonBadgesTab userId="u1" />)

    const user = userEvent.setup()
    const input = screen.getByPlaceholderText(/Tag UID/)
    await act(async () => {
      await user.type(input, "abc123")
      await user.click(screen.getByRole("button", { name: /Tag hinzufügen/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalledWith(
      "Tag konnte nicht hinzugefügt werden",
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("handleAddTag: success surfaces German confirmation toast", async () => {
    mockSet.mockResolvedValueOnce(undefined)

    render(<PersonBadgesTab userId="u1" />)

    const user = userEvent.setup()
    const input = screen.getByPlaceholderText(/Tag UID/)
    await act(async () => {
      await user.type(input, "abc123")
      await user.click(screen.getByRole("button", { name: /Tag hinzufügen/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockToastSuccess).toHaveBeenCalledWith("Tag hinzugefügt")
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("handleToggleTag: failure surfaces German error toast (was silent before #182)", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("update rejected"))

    render(<PersonBadgesTab userId="u1" />)

    const user = userEvent.setup()
    // The default token is active; the action button reads "Deaktivieren".
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Deaktivieren/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalledWith(
      "Tag-Status konnte nicht geändert werden",
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })
})
