// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { vi, describe, it, expect, afterEach, beforeEach } from "vitest"

// Mock QR code component
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string; size: number }) => (
    <div data-testid="qrcode" data-value={props.value} />
  ),
}))

// Mock firestore hook
const mockUseDocument = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useDocument: (...args: any[]) => mockUseDocument(...args),
}))

// Mock firebase context
const mockFunctions = {}
vi.mock("@modules/lib/firebase-context", () => ({
  useFunctions: () => mockFunctions,
}))

// Mock httpsCallable
const mockCallableResult = vi.fn()
vi.mock("firebase/functions", () => ({
  httpsCallable: () => mockCallableResult,
}))

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PaymentResult } from "./payment-result"

describe("PaymentResult", () => {
  beforeEach(() => {
    // Default: checkout has billRef, payment data loaded
    mockUseDocument.mockImplementation((path: string | null) => {
      if (path?.startsWith("checkouts/")) {
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
    mockUseDocument.mockImplementation((path: string | null) => {
      if (path?.startsWith("checkouts/")) {
        return { data: { id: "checkout-1", billRef: null }, loading: false, error: null }
      }
      return { data: null, loading: false, error: null }
    })

    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)
    expect(screen.getByText(/QR-Code wird geladen/)).toBeDefined()
  })
})
