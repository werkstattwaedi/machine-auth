// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #182: the admin tag operations
 * (`handleAddTag`, `handleToggleTag`) now route through
 * `useAsyncMutation`. A rejection MUST surface a German error toast
 * (silent before); a success MUST surface a German confirmation toast.
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

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => () => Promise.resolve({ data: { ok: true } }),
}))

let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return {
      ...opts,
      useParams: () => ({ userId: "u1" }),
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
  userRef: (_db: unknown, id: string) => ({ id, path: `users/${id}` }),
  tokenRef: (_db: unknown, id: string) => ({ id, path: `tokens/${id}` }),
  tokensCollection: (_db: unknown) => ({ path: "tokens" }),
  permissionRef: (_db: unknown, id: string) => ({ id, path: `permission/${id}` }),
  permissionsCollection: (_db: unknown) => ({ path: "permission" }),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
  useFirebaseAuth: () => ({}),
}))

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({ user: { uid: "admin-uid" }, userDoc: null, loading: false }),
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

// Stub all the shadcn/Radix UI primitives the page renders. The full
// real tree (Tabs + Checkbox + Label + Badge + Table) hits an infinite
// ref-update loop in jsdom and OOMs the test worker. The migrated
// surface — `handleAddTag` / `handleToggleTag` — only needs the Input
// + Button + Table cells to be exercisable, so we replace the whole
// UI shell with thin pass-throughs.
vi.mock("@modules/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@modules/components/ui/checkbox", () => ({
  Checkbox: (props: Record<string, unknown>) => (
    <input type="checkbox" {...(props as React.InputHTMLAttributes<HTMLInputElement>)} />
  ),
}))
vi.mock("@modules/components/ui/label", () => ({
  Label: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => (
    <label {...(rest as React.LabelHTMLAttributes<HTMLLabelElement>)}>{children}</label>
  ),
}))
vi.mock("@modules/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))
vi.mock("@modules/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => (
    <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>{children}</span>
  ),
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

await import("./$userId")

function setupDefaults() {
  // Critical: cache the returned objects so React sees stable references
  // across renders. Returning a fresh `{ data: ... }` per call would
  // re-trigger the page's `useEffect` that calls `reset(...)`, which in
  // turn re-renders, looping until OOM.
  const userResult = {
    data: {
      id: "u1",
      firstName: "Test",
      lastName: "Admin",
      email: "test@example.com",
      roles: [],
      permissions: [],
      userType: "erwachsen",
    },
    loading: false,
    error: null,
  }
  const emptyResult = { data: null, loading: false, error: null }
  mockUseDocument.mockImplementation((ref: { path?: string } | null) =>
    ref?.path?.startsWith("users/") ? userResult : emptyResult,
  )

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
  const emptyCollection = { data: [], loading: false, error: null }
  mockUseCollection.mockImplementation((ref: { path?: string } | null) =>
    ref?.path === "tokens" ? tokensResult : emptyCollection,
  )
}

describe("UserDetailPage tag operations error envelope (issue #182)", () => {
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

    const Component = CapturedComponent!
    render(<Component />)

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

  it("handleToggleTag: failure surfaces German error toast (was silent before #182)", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("update rejected"))

    const Component = CapturedComponent!
    render(<Component />)

    const user = userEvent.setup()
    // The default token is active; the action button reads "Deaktivieren".
    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: /Deaktivieren/ }),
      )
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
