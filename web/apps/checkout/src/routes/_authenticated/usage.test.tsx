// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode } from "react"
import { FirebaseProvider, type FirebaseServices } from "@modules/lib/firebase-context"
import { FakeFirestore } from "@modules/test/fake-firestore"

// ── Mocks ──────────────────────────────────────────────────────────────

let fakeDb: FakeFirestore

// Capture the component passed to createFileRoute
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
}))

// Mock auth
const mockUserDoc = {
  id: "user1",
  displayName: "Max Muster",
  rawDisplayName: null,
  firstName: "Max",
  lastName: "Muster",
  email: "max@test.com",
  roles: [],
  permissions: [],
  userType: "erwachsen",
  billingAddress: null,
}

let mockAuthReturn: Record<string, unknown> = {
  user: { uid: "user1" },
  userDoc: mockUserDoc,
  userDocLoading: false,
  loading: false,
  isAdmin: false,
}

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockAuthReturn,
}))

// Mock firebase/firestore — redirect to FakeFirestore
vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore")
  return {
    ...actual,
    collection: (...args: unknown[]) => {
      const path = args[1] as string
      return fakeDb.collection(path)
    },
    doc: (...args: unknown[]) => {
      const segments = (args as unknown[]).slice(1) as string[]
      return fakeDb.doc(...segments)
    },
    query: (_ref: unknown, ...constraints: unknown[]) => {
      const ref = _ref as { path: string }
      return {
        type: "query",
        collectionPath: ref.path,
        constraints: constraints as { kind: string }[],
      }
    },
    onSnapshot: (
      refOrQuery: { type: string; path?: string; collectionPath?: string; constraints?: unknown[] },
      onNext: (snap: unknown) => void,
      onError?: (err: Error) => void,
    ) => {
      try {
        if (refOrQuery.type === "document") {
          return fakeDb.onSnapshotDoc(
            refOrQuery as ReturnType<FakeFirestore["doc"]>,
            onNext as Parameters<FakeFirestore["onSnapshotDoc"]>[1],
          )
        }
        const path = refOrQuery.collectionPath ?? refOrQuery.path ?? ""
        const constraints = (refOrQuery as { constraints?: unknown[] }).constraints ?? []
        return fakeDb.onSnapshotCollection(
          fakeDb.collection(path),
          constraints as Parameters<FakeFirestore["onSnapshotCollection"]>[1],
          onNext as Parameters<FakeFirestore["onSnapshotCollection"]>[2],
        )
      } catch (err) {
        onError?.(err as Error)
        return () => {}
      }
    },
    where: (field: string, op: string, value: unknown) => ({
      kind: "where",
      field,
      op,
      value,
    }),
    orderBy: (field: string, direction: string = "asc") => ({
      kind: "orderBy",
      field,
      direction,
    }),
  }
})

// Mock firebase/functions
const mockCallable = vi.fn()
vi.mock("firebase/functions", () => ({
  httpsCallable: () => mockCallable,
}))

// Mock sonner
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}))

// Import the module after mocks — this triggers createFileRoute and captures the component
await import("./usage")

// ── Test helpers ───────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return <FirebaseProvider value={services}>{children}</FirebaseProvider>
}

function renderUsagePage() {
  const Component = CapturedComponent!
  return render(<Component />, { wrapper: Wrapper })
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("Usage page", () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore()
    mockCallable.mockReset()
    mockToastError.mockReset()
    mockAuthReturn = {
      user: { uid: "user1" },
      userDoc: mockUserDoc,
      userDocLoading: false,
      loading: false,
      isAdmin: false,
    }
  })

  afterEach(() => {
    cleanup()
  })

  it("captures the route component", () => {
    expect(CapturedComponent).toBeTypeOf("function")
  })

  it("shows empty states when no bills or checkouts exist", async () => {
    renderUsagePage()

    await waitFor(() => {
      expect(screen.getByText("Nutzungsverlauf")).toBeInTheDocument()
    })
    expect(screen.getByText("Keine Rechnungen")).toBeInTheDocument()
    // Unbilled checkouts section is hidden when empty
    expect(screen.queryByText("Nicht verrechnete Checkouts")).not.toBeInTheDocument()
  })

  it("shows account error when userDoc is missing", () => {
    mockAuthReturn = {
      user: null,
      userDoc: null,
      userDocLoading: false,
      loading: false,
      isAdmin: false,
    }

    renderUsagePage()

    expect(screen.getByText("Konto nicht gefunden")).toBeInTheDocument()
  })

  it("shows loading state while userDoc is loading", () => {
    mockAuthReturn = {
      user: null,
      userDoc: null,
      userDocLoading: true,
      loading: true,
      isAdmin: false,
    }

    renderUsagePage()

    expect(screen.queryByText("Konto nicht gefunden")).not.toBeInTheDocument()
    expect(screen.queryByText("Nutzungsverlauf")).not.toBeInTheDocument()
  })

  it("renders bills with reference number and paid status", async () => {
    fakeDb.setDoc(fakeDb.doc("bills", "bill1"), {
      userId: fakeDb.doc("users", "user1"),
      checkouts: [],
      referenceNumber: 42,
      amount: 75.5,
      currency: "CHF",
      storagePath: "invoices/bill1.pdf",
      created: new Date("2025-06-15"),
      paidAt: new Date("2025-06-20"),
      paidVia: "twint",
    })

    renderUsagePage()

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument()
    })
    expect(screen.getByText("Bezahlt (TWINT)")).toBeInTheDocument()
  })

  it("renders unpaid bill with 'Offen' badge", async () => {
    fakeDb.setDoc(fakeDb.doc("bills", "bill2"), {
      userId: fakeDb.doc("users", "user1"),
      checkouts: [],
      referenceNumber: 10,
      amount: 30,
      currency: "CHF",
      storagePath: "invoices/bill2.pdf",
      created: new Date("2025-07-01"),
      paidAt: null,
      paidVia: null,
    })

    renderUsagePage()

    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument()
    })
    expect(screen.getByText("Offen")).toBeInTheDocument()
  })

  it("renders unbilled checkouts", async () => {
    fakeDb.setDoc(fakeDb.doc("checkouts", "co1"), {
      userId: fakeDb.doc("users", "user1"),
      status: "closed",
      created: new Date("2025-06-10"),
      closedAt: new Date("2025-06-10"),
      summary: { totalPrice: 45 },
      billRef: null,
    })

    renderUsagePage()

    // Wait for the page to finish loading (heading appears once both queries resolve)
    await waitFor(() => {
      expect(screen.getByText("Nutzungsverlauf")).toBeInTheDocument()
    })
    expect(screen.getByText("Nicht verrechnete Checkouts")).toBeInTheDocument()
  })

  it("download button calls getInvoiceDownloadUrl and opens URL", async () => {
    const user = userEvent.setup()
    mockCallable.mockResolvedValue({ data: { url: "https://example.com/invoice.pdf" } })
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    fakeDb.setDoc(fakeDb.doc("bills", "bill3"), {
      userId: fakeDb.doc("users", "user1"),
      checkouts: [],
      referenceNumber: 5,
      amount: 100,
      currency: "CHF",
      storagePath: "invoices/bill3.pdf",
      created: new Date("2025-07-15"),
      paidAt: null,
      paidVia: null,
    })

    renderUsagePage()

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument()
    })

    const downloadBtn = screen.getByRole("button", { name: "PDF herunterladen" })
    await user.click(downloadBtn)

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledWith({ billId: "bill3" })
    })
    expect(openSpy).toHaveBeenCalledWith("https://example.com/invoice.pdf", "_blank")

    openSpy.mockRestore()
  })

  it("download button shows error toast on failure", async () => {
    const user = userEvent.setup()
    mockCallable.mockRejectedValue(new Error("network error"))

    fakeDb.setDoc(fakeDb.doc("bills", "bill4"), {
      userId: fakeDb.doc("users", "user1"),
      checkouts: [],
      referenceNumber: 7,
      amount: 50,
      currency: "CHF",
      storagePath: "invoices/bill4.pdf",
      created: new Date("2025-08-01"),
      paidAt: null,
      paidVia: null,
    })

    renderUsagePage()

    await waitFor(() => {
      expect(screen.getByText("7")).toBeInTheDocument()
    })

    const downloadBtn = screen.getByRole("button", { name: "PDF herunterladen" })
    await user.click(downloadBtn)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("PDF konnte nicht geladen werden.")
    })
  })

  it("does not show download button when storagePath is null", async () => {
    fakeDb.setDoc(fakeDb.doc("bills", "bill5"), {
      userId: fakeDb.doc("users", "user1"),
      checkouts: [],
      referenceNumber: 99,
      amount: 20,
      currency: "CHF",
      storagePath: null,
      created: new Date("2025-09-01"),
      paidAt: null,
      paidVia: null,
    })

    renderUsagePage()

    await waitFor(() => {
      expect(screen.getByText("99")).toBeInTheDocument()
    })

    expect(screen.queryByRole("button", { name: "PDF herunterladen" })).not.toBeInTheDocument()
  })
})
