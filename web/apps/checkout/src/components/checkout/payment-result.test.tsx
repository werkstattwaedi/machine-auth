// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { vi, describe, it, expect, afterEach, beforeEach } from "vitest"

// Mock QR code component
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string; size: number }) => (
    <div data-testid="qrcode" data-value={props.value} />
  ),
}))

// Mock firestore hook. After the canonical refactor (issue #145), `useDocument`
// receives a typed DocumentReference (or null). Our fake returns a ref-shaped
// object whose `.path` we can use to discriminate which doc was requested.
const mockUseDocument = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useDocument: (ref: { path?: string } | null) => mockUseDocument(ref),
}))

// Mock the helper so tests don't need a live Firestore instance.
vi.mock("@modules/lib/firestore-helpers", () => ({
  checkoutRef: (_db: unknown, id: string) => ({ id, path: `checkouts/${id}` }),
}))

// Mock firebase context
const mockFunctions = {}
const mockDb = {}
vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => mockDb,
  useFunctions: () => mockFunctions,
}))

// Mock httpsCallable
const mockCallableResult = vi.fn()
vi.mock("firebase/functions", () => ({
  httpsCallable: () => mockCallableResult,
}))

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PaymentResult, SWISS_CROSS_SVG } from "./payment-result"

describe("PaymentResult", () => {
  beforeEach(() => {
    // Default: checkout has billRef, payment data loaded
    mockUseDocument.mockImplementation((ref: { path?: string } | null) => {
      if (ref?.path?.startsWith("checkouts/")) {
        return { data: { id: "checkout-1", billRef: { id: "bill-1" } }, loading: false, error: null }
      }
      return { data: null, loading: false, error: null }
    })

    mockCallableResult.mockResolvedValue({
      data: {
        qrBillPayload: "SPC\n0200\n1\nCH0000000000000000000\ntest-payload",
        paylinkUrl: "https://pay.raisenow.io/test",
        creditor: {
          iban: "CH56 0681 4580 1260 0509 7",
          name: "Offene Werkstatt Wädenswil",
          street: "Tobelrainstrasse 25",
          location: "8820 Wädenswil",
        },
        reference: "RF48000000001",
        payerName: "Max Muster",
        amount: "25.00",
        currency: "CHF",
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows default "Zurück zum Start" when no resetLabel prop is provided', () => {
    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)
    expect(screen.getByRole("button", { name: "Zurück zum Start" })).toBeDefined()
  })

  it("shows custom resetLabel when provided", () => {
    render(
      <PaymentResult
        checkoutId="checkout-1"
        totalPrice={25}
        resetLabel="Zurück zum Besuch"
        onReset={() => {}}
      />,
    )
    expect(screen.getByRole("button", { name: "Zurück zum Besuch" })).toBeDefined()
    expect(screen.queryByText("Zurück zum Start")).toBeNull()
  })

  it("calls onReset when button is clicked", async () => {
    const handleReset = vi.fn()
    render(<PaymentResult checkoutId="checkout-1" totalPrice={10} onReset={handleReset} />)

    await userEvent.click(screen.getByRole("button", { name: "Zurück zum Start" }))
    expect(handleReset).toHaveBeenCalledOnce()
  })

  it("displays the total price formatted as CHF", () => {
    render(<PaymentResult checkoutId="checkout-1" totalPrice={42.5} onReset={() => {}} />)
    expect(screen.getByText(/42.50/)).toBeDefined()
  })

  it("shows E-Banking selected by default with QR code", async () => {
    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)

    const qrCode = await screen.findByTestId("qrcode")
    expect(qrCode.getAttribute("data-value")).toContain("SPC")
    expect(screen.getByText("Empfohlen")).toBeDefined()
    expect(screen.getByText(/Gebührenfrei/)).toBeDefined()
  })

  it("shows PayLink button when TWINT is selected", async () => {
    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)

    await screen.findByTestId("qrcode")

    // Click TWINT option
    await userEvent.click(screen.getByRole("button", { name: /TWINT/ }))

    const link = screen.getByRole("link", { name: /Mit TWINT bezahlen/ })
    expect(link.getAttribute("href")).toBe("https://pay.raisenow.io/test")
    expect(screen.getByText(/Transaktionsgebühren/)).toBeDefined()
  })

  it("displays QR bill details: creditor, reference, and payer name", async () => {
    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)

    await screen.findByTestId("qrcode")

    // Creditor info
    expect(screen.getByText("Konto / Zahlbar an")).toBeDefined()
    expect(screen.getByText("CH56 0681 4580 1260 0509 7")).toBeDefined()
    expect(screen.getByText("Offene Werkstatt Wädenswil")).toBeDefined()
    expect(screen.getByText("Tobelrainstrasse 25")).toBeDefined()
    expect(screen.getByText("8820 Wädenswil")).toBeDefined()

    // Reference
    expect(screen.getByText("Referenz")).toBeDefined()
    expect(screen.getByText("RF48000000001")).toBeDefined()

    // Payer
    expect(screen.getByText("Zahlbar durch")).toBeDefined()
    expect(screen.getByText("Max Muster")).toBeDefined()

    // Currency / amount
    expect(screen.getByText("CHF")).toBeDefined()
    expect(screen.getByText("25.00")).toBeDefined()
  })

  it("shows error state when callable fails", async () => {
    mockCallableResult.mockRejectedValue(new Error("fail"))

    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)

    const error = await screen.findByText(/QR-Code konnte nicht geladen werden/)
    expect(error).toBeDefined()
  })

  it("shows loading state when bill not yet created", () => {
    mockUseDocument.mockImplementation((ref: { path?: string } | null) => {
      if (ref?.path?.startsWith("checkouts/")) {
        return { data: { id: "checkout-1", billRef: null }, loading: false, error: null }
      }
      return { data: null, loading: false, error: null }
    })

    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)
    expect(screen.getByText(/QR-Code wird geladen/)).toBeDefined()
  })

  // Regression test for issue #109: the Swiss cross overlay must match the
  // SIX QR-bill spec (white border, black square, white cross), not the
  // inverted arrangement that shipped previously.
  it("uses the spec-compliant Swiss cross color arrangement (white cross on black)", () => {
    const prefix = "data:image/svg+xml,"
    expect(SWISS_CROSS_SVG.startsWith(prefix)).toBe(true)

    const svg = decodeURIComponent(SWISS_CROSS_SVG.slice(prefix.length))

    // Outer 100x100 rect: white border
    expect(svg).toMatch(/<rect width="100" height="100" fill="white"\/>/)
    // Inner 94x94 rect (3px inset): black square
    expect(svg).toMatch(/<rect x="3" y="3" width="94" height="94" fill="black"\/>/)
    // Cross polygon: white
    expect(svg).toMatch(/<polygon points="[^"]+" fill="white"\/>/)

    // Defensive: no inverted colors leak back in.
    expect(svg).not.toMatch(/<rect width="100" height="100" fill="black"\/>/)
    expect(svg).not.toMatch(/<polygon points="[^"]+" fill="black"\/>/)
  })
})
