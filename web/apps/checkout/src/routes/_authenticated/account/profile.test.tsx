// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Issue #663: every profile input must be reachable by its visible label —
// assistive tech (and Playwright's `getByLabel`) saw bare textboxes before
// the labels were wired to their inputs via `htmlFor`/`id`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode } from "react"
import { FirebaseProvider, type FirebaseServices } from "@modules/lib/firebase-context"

// ── Mocks ──────────────────────────────────────────────────────────────

// Capture the component passed to createFileRoute
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
}))

const mockUserDoc = {
  id: "user1",
  name: "Max Muster",
  firstName: "Max",
  lastName: "Muster",
  email: "max@test.com",
  roles: [],
  permissions: [],
  userType: "erwachsen",
  billingAddress: { company: "", street: "Seestrasse 12", zip: "8820", city: "Wädenswil" },
  phone: "+41791234567",
}

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "user1", email: "max@test.com" },
    userDoc: mockUserDoc,
    userDocLoading: false,
    loading: false,
    isAdmin: false,
    sessionKind: "user",
  }),
}))

// The page only reads the permissions list and writes through the mutation
// hook — stub both so no Firestore instance is needed.
vi.mock("@modules/lib/firestore", () => ({
  useCollection: () => ({ data: [], loading: false, error: null }),
}))
const mockUpdate = vi.fn()
vi.mock("@modules/hooks/use-firestore-mutation", () => ({
  useFirestoreMutation: () => ({ update: mockUpdate, loading: false, error: null }),
}))
vi.mock("@modules/lib/firestore-helpers", () => ({
  permissionsCollection: () => ({ path: "permission" }),
  userRef: (_db: unknown, id: string) => ({ path: `users/${id}` }),
}))

// Phone verification is its own feature (and needs a real Auth user with
// `reload()`); it is not part of the label wiring under test.
vi.mock("@/components/account/phone-verification", () => ({
  PhoneVerification: () => null,
}))

// Import the module after mocks — this triggers createFileRoute and captures the component
await import("./profile")

// ── Test helpers ───────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return <FirebaseProvider value={services}>{children}</FirebaseProvider>
}

function renderProfilePage() {
  const Component = CapturedComponent!
  return render(<Component />, { wrapper: Wrapper })
}

const input = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement

// ── Tests ──────────────────────────────────────────────────────────────

describe("Profile page accessible names", () => {
  beforeEach(() => {
    mockUpdate.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it("labels every text field so it can be found by its visible label", async () => {
    renderProfilePage()

    // The form is populated by a reset() effect once the user doc arrives.
    await waitFor(() => expect(input("Vorname").value).toBe("Max"))

    expect(input("Vorname").tagName).toBe("INPUT")
    expect(input("Nachname").value).toBe("Muster")
    expect(input("Strasse und Hausnummer").value).toBe("Seestrasse 12")
    expect(input("PLZ").value).toBe("8820")
    expect(input("Ort").value).toBe("Wädenswil")
    expect(input(/Telefon/).value).toBe("+41791234567")

    const email = input("E-Mail")
    expect(email.value).toBe("max@test.com")
    expect(email.disabled).toBe(true)
  })

  it("names the Nutzer:in radio group and labels the Firmenname field", async () => {
    renderProfilePage()
    await waitFor(() => expect(input("Vorname").value).toBe("Max"))

    expect(screen.getByRole("radiogroup", { name: "Nutzer:in" })).toBeTruthy()
    expect(screen.queryByLabelText("Firmenname")).toBeNull()

    await userEvent.click(screen.getByRole("radio", { name: "Firma" }))

    expect(input("Firmenname").tagName).toBe("INPUT")
  })
})
