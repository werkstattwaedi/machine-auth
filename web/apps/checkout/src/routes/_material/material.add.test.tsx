// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #182: the multi-step submit on
 * /material/add now routes through `useAsyncMutation`. A `writeBatch`
 * rejection MUST surface a German toast and MUST NOT flip the form
 * into the success state. Before the migration the `try/finally` only
 * managed the `submitting` flag; the user saw a re-enabled button with
 * no feedback.
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
      useSearch: () => ({ id: "cat-1", priceList: undefined }),
    }
  },
  Link: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...(props as Record<string, string>)}>{children}</a>
  ),
}))

const mockUseAuth = vi.fn()
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}))

const mockUseDocument = vi.fn()
const mockUseCollection = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useDocument: (ref: unknown) => mockUseDocument(ref),
  useCollection: (...args: unknown[]) => mockUseCollection(...args),
}))

vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: (_db: unknown, id: string) => ({ id, path: `users/${id}` }),
  catalogRef: (_db: unknown, id: string) => ({ id, path: `catalog/${id}` }),
  catalogCollection: (_db: unknown) => ({ path: "catalog" }),
  priceListRef: (_db: unknown, id: string) => ({ id, path: `priceList/${id}` }),
  checkoutsCollection: (_db: unknown) => ({ path: "checkouts" }),
  checkoutItemsCollection: (_db: unknown, coId: string) => ({
    path: `checkouts/${coId}/items`,
  }),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
  useFirebaseAuth: () => ({}),
}))

const mockAdd = vi.fn().mockResolvedValue({ id: "new-item" })
vi.mock("@modules/hooks/use-firestore-mutation", () => ({
  useFirestoreMutation: () => ({
    add: mockAdd,
    update: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
    mutate: vi.fn(),
    loading: false,
    error: null,
  }),
}))

// `writeBatch` and `getDocs` come from `firebase/firestore`. Keep most
// real exports but stub the bits the page calls.
const mockBatchCommit = vi.fn()
const mockGetDocs = vi.fn()
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>()
  return {
    ...actual,
    serverTimestamp: () => "server-ts",
    getDocs: (...args: unknown[]) => mockGetDocs(...args),
    query: () => ({}),
    where: () => ({}),
    doc: (collRef: { path: string }, id?: string) => ({
      id: id ?? "new-doc-id",
      path: id ? `${collRef.path}/${id}` : `${collRef.path}/new-doc-id`,
    }),
    writeBatch: () => ({
      set: vi.fn(),
      commit: mockBatchCommit,
    }),
    documentId: actual.documentId,
  }
})

await import("./material.add")

describe("material.add submit error envelope (issue #182)", () => {
  beforeEach(() => {
    mockAdd.mockClear()
    mockBatchCommit.mockReset()
    mockGetDocs.mockReset()
    mockToastError.mockReset()
    mockToastSuccess.mockReset()

    mockUseAuth.mockReturnValue({
      user: { uid: "u1" },
      userDoc: {
        id: "u1",
        displayName: "Test",
        firstName: "Test",
        lastName: "User",
        roles: [],
        permissions: [],
      },
      loading: false,
    })

    mockUseDocument.mockImplementation((ref: { path?: string } | null) => {
      if (ref?.path?.startsWith("catalog/")) {
        return {
          data: {
            id: "cat-1",
            name: "Test Material",
            description: "",
            unitPrice: { none: 5 },
            workshops: ["makerspace"],
            pricingModel: "quantity",
          },
          loading: false,
          error: null,
        }
      }
      return { data: null, loading: false, error: null }
    })
    mockUseCollection.mockReturnValue({
      data: [],
      loading: false,
      error: null,
    })

    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation((q: string) => ({
        matches: false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("submit failure surfaces toast and does NOT flip to success card", async () => {
    // Simulate "no open checkout" → batch path
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] })
    mockBatchCommit.mockRejectedValueOnce(new Error("commit rejected"))

    const Component = CapturedComponent!
    render(<Component />)

    // Sanity: form is rendered, not the success card.
    expect(screen.queryByText("Material hinzugefügt")).toBeNull()
    const submitButton = screen.getByRole("button", { name: /Hinzufügen/ })

    const user = userEvent.setup()
    await act(async () => {
      await user.click(submitButton)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalledWith(
      "Material konnte nicht hinzugefügt werden",
    )
    // Critical: success card must not appear after a failed submit.
    expect(screen.queryByText("Material hinzugefügt")).toBeNull()
  })
})
