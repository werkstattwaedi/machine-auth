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
    // Default: checkout has billRef, bill is unpaid, QR data loaded
    mockUseDocument.mockImplementation((path: string | null) => {
      if (path?.startsWith("checkouts/")) {
        return { data: { id: "checkout-1", billRef: { id: "bill-1" } }, loading: false, error: null }
      }
      if (path?.startsWith("bills/")) {
        return { data: { id: "bill-1", referenceNumber: 42, amount: 25, paidAt: null, paidVia: null }, loading: false, error: null }
      }
      return { data: null, loading: false, error: null }
    })

    mockCallableResult.mockResolvedValue({
      data: { qrPayload: "SPC\n0200\n1\nCH0000000000000000000\ntest-payload" },
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

  it("shows paid state when bill has paidAt", () => {
    mockUseDocument.mockImplementation((path: string | null) => {
      if (path?.startsWith("checkouts/")) {
        return { data: { id: "checkout-1", billRef: { id: "bill-1" } }, loading: false, error: null }
      }
      if (path?.startsWith("bills/")) {
        return { data: { id: "bill-1", referenceNumber: 42, amount: 25, paidAt: { toDate: () => new Date() }, paidVia: "twint" }, loading: false, error: null }
      }
      return { data: null, loading: false, error: null }
    })

    render(<PaymentResult checkoutId="checkout-1" totalPrice={25} onReset={() => {}} />)
    expect(screen.getByText("Bezahlt – Vielen Dank!")).toBeDefined()
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
