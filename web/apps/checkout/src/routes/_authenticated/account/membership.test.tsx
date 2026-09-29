// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `MemberRow` (family roster). Issue #654: a co-member listener that is
 * denied must not render as an endless loading skeleton — the row falls
 * back to a visible "could not load" entry once the hook gives up.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { type ReactNode } from "react"
import { FirebaseProvider, type FirebaseServices } from "@modules/lib/firebase-context"

// The route file registers itself with the router at import time.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}))

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({ userDoc: null, user: null, loading: false, isAdmin: false }),
}))
vi.mock("@modules/lib/use-bridge", () => ({ useBridge: () => null }))
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: () => vi.fn(),
  reportRpcError: vi.fn(),
}))

// The row's only data source. Each test scripts what the hook returns.
const mockUseDocument = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useDocument: (...args: unknown[]) => mockUseDocument(...args),
  useCollection: () => ({ data: [], loading: false, error: null }),
}))

// `userRef` calls the SDK's `doc()`, which rejects the stub db in context.
vi.mock("@modules/lib/firestore-helpers", async () => {
  const actual = await vi.importActual<typeof import("@modules/lib/firestore-helpers")>(
    "@modules/lib/firestore-helpers",
  )
  return {
    ...actual,
    userRef: (_db: unknown, id: string) => ({ type: "document", id, path: `users/${id}` }),
  }
})

const { MemberRow } = await import("./membership")

function Wrapper({ children }: { children: ReactNode }) {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return <FirebaseProvider value={services}>{children}</FirebaseProvider>
}

function renderRow(props: Partial<React.ComponentProps<typeof MemberRow>> = {}) {
  return render(
    <ul>
      <MemberRow userId="u2" isOwner={false} onRemove={null} removing={false} {...props} />
    </ul>,
    { wrapper: Wrapper },
  )
}

const skeletons = (container: HTMLElement) =>
  container.querySelectorAll('[data-slot="skeleton"]')

describe("MemberRow", () => {
  beforeEach(() => {
    mockUseDocument.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it("subscribes with a bounded permission-denied retry (issue #654)", () => {
    mockUseDocument.mockReturnValue({ data: null, loading: true, error: null })
    renderRow()
    expect(mockUseDocument).toHaveBeenCalledWith(
      expect.objectContaining({ path: "users/u2" }),
      { retry: { attempts: 3, delayMs: 1000 } },
    )
  })

  it("renders a skeleton while loading", () => {
    mockUseDocument.mockReturnValue({ data: null, loading: true, error: null })
    const { container } = renderRow()
    expect(skeletons(container).length).toBeGreaterThan(0)
    expect(screen.queryByText("Konnte nicht geladen werden")).toBeNull()
  })

  it("renders a fallback row — not a skeleton — once the listener has failed", () => {
    const onRemove = vi.fn()
    mockUseDocument.mockReturnValue({
      data: null,
      loading: false,
      error: Object.assign(new Error("denied"), { code: "permission-denied" }),
    })
    const { container } = renderRow({ onRemove })

    expect(skeletons(container)).toHaveLength(0)
    const row = screen.getByTestId("member-row-unavailable")
    expect(row).toHaveTextContent("Mitglied")
    expect(row).toHaveTextContent("Konnte nicht geladen werden")
    // The owner can still act on the entry.
    fireEvent.click(screen.getByRole("button", { name: /Entfernen/ }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it("renders a fallback row for a missing user doc", () => {
    mockUseDocument.mockReturnValue({ data: null, loading: false, error: null })
    const { container } = renderRow()
    expect(skeletons(container)).toHaveLength(0)
    expect(screen.getByTestId("member-row-unavailable")).toBeInTheDocument()
  })

  it("renders the member once the doc resolves", () => {
    mockUseDocument.mockReturnValue({
      data: {
        id: "u2",
        firstName: "Anna",
        lastName: "Beispiel",
        email: "anna@beispiel.ch",
        userType: "erwachsen",
      },
      loading: false,
      error: null,
    })
    const { container } = renderRow({ isOwner: true })
    expect(skeletons(container)).toHaveLength(0)
    expect(screen.queryByTestId("member-row-unavailable")).toBeNull()
    expect(screen.getByText("Anna Beispiel")).toBeInTheDocument()
    expect(screen.getByText("Erwachsen · anna@beispiel.ch")).toBeInTheDocument()
    expect(screen.getByText("Inhaber:in")).toBeInTheDocument()
  })
})
