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

// Mock sonner — `useAsyncMutation` (used by the migrated QR fallback,
// issue #182) toasts on rejection.
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

// Mock httpsCallable
const mockCallableResult = vi.fn()
vi.mock("firebase/functions", () => ({
  httpsCallable: () => mockCallableResult,
}))

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PaymentResult, SWISS_CROSS_SVG } from "./payment-result"

const PAYMENT_FIXTURE = {
  billId: "bill-1",
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
  payerEmail: "max@test.com",
  amount: "25.00",
  currency: "CHF",
}

describe("PaymentResult", () => {
  beforeEach(() => {
    // Default: checkout has billRef, payment data loaded
    mockUseDocument.mockImplementation((ref: { path?: string } | null) => {
      if (ref?.path?.startsWith("checkouts/")) {
        return { data: { id: "checkout-1", billRef: { id: "bill-1" } }, loading: false, error: null }
      }
      return { data: null, loading: false, error: null }
    })

    mockCallableResult.mockResolvedValue({ data: PAYMENT_FIXTURE })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe("Rechnung flow", () => {
    it('shows default "Fertig" reset button when no resetLabel prop is provided', () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.getByRole("button", { name: "Fertig" })).toBeDefined()
    })

    it("shows custom resetLabel when provided", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          resetLabel="Zurück zum Besuch"
          onReset={() => {}}
          selectedMethod="ebanking"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.getByRole("button", { name: "Zurück zum Besuch" })).toBeDefined()
      expect(screen.queryByText("Fertig")).toBeNull()
    })

    it("calls onReset when reset button is clicked", async () => {
      const handleReset = vi.fn()
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={10}
          onReset={handleReset}
          selectedMethod="ebanking"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )

      await userEvent.click(screen.getByRole("button", { name: "Fertig" }))
      expect(handleReset).toHaveBeenCalledOnce()
    })

    it("shows the QR code and Rechnung headline when ebanking is selected", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )

      expect(screen.getByText("QR-Rechnung scannen")).toBeDefined()
      const qrCode = screen.getByTestId("qrcode")
      expect(qrCode.getAttribute("data-value")).toContain("SPC")
    })

    it("shows the email and total in the lede", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      // Email appears in the lede *and* in the QR bill payer block; just
      // verify both surfaces show it.
      expect(screen.getAllByText("max@test.com").length).toBeGreaterThanOrEqual(1)
    })

    it("renders PDF herunterladen and IBAN kopieren buttons", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.getByRole("button", { name: /PDF herunterladen/ })).toBeDefined()
      expect(screen.getByRole("button", { name: /IBAN kopieren/ })).toBeDefined()
    })

    it("displays QR bill details: creditor, reference, and payer name", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )

      expect(screen.getByText("Konto / Zahlbar an")).toBeDefined()
      expect(screen.getByText("CH56 0681 4580 1260 0509 7")).toBeDefined()
      expect(screen.getByText("Offene Werkstatt Wädenswil")).toBeDefined()
      expect(screen.getByText("Tobelrainstrasse 25")).toBeDefined()
      expect(screen.getByText("8820 Wädenswil")).toBeDefined()
      expect(screen.getByText("Referenz")).toBeDefined()
      expect(screen.getByText("RF48000000001")).toBeDefined()
      expect(screen.getByText("Zahlbar durch")).toBeDefined()
      expect(screen.getByText("Max Muster")).toBeDefined()
      expect(screen.getByText("CHF")).toBeDefined()
      expect(screen.getByText("25.00")).toBeDefined()
    })
  })

  describe("TWINT flow", () => {
    it("renders the TWINT pay-link and headline when selectedMethod=twint", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="twint"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )

      expect(
        screen.getByRole("heading", { name: "Mit TWINT bezahlen" }),
      ).toBeDefined()
      const link = screen.getByRole("link", { name: /Mit TWINT bezahlen/ })
      expect(link.getAttribute("href")).toBe("https://pay.raisenow.io/test")
      expect(screen.getByText(/Transaktionsgebühren/)).toBeDefined()
    })

    it("does NOT render the QR code when TWINT is selected", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="twint"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.queryByTestId("qrcode")).toBeNull()
      expect(screen.queryByText("QR-Rechnung scannen")).toBeNull()
    })

    it("does NOT render PDF/IBAN action buttons in the TWINT flow", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="twint"
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.queryByRole("button", { name: /PDF herunterladen/ })).toBeNull()
      expect(screen.queryByRole("button", { name: /IBAN kopieren/ })).toBeNull()
    })
  })

  describe("Loading and error states", () => {
    it("shows loading state when bill not yet created", () => {
      mockUseDocument.mockImplementation((ref: { path?: string } | null) => {
        if (ref?.path?.startsWith("checkouts/")) {
          return { data: { id: "checkout-1", billRef: null }, loading: false, error: null }
        }
        return { data: null, loading: false, error: null }
      })

      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
        />,
      )
      expect(screen.getByText(/QR-Code wird geladen/)).toBeDefined()
    })

    it("shows error state when callable fails", async () => {
      mockCallableResult.mockRejectedValue(new Error("fail"))

      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
        />,
      )

      const error = await screen.findByText(/QR-Code konnte nicht geladen werden/)
      expect(error).toBeDefined()
    })

    // Regression test for issue #182: the legacy `getPaymentQrData`
    // fallback now routes through `useAsyncMutation`. On failure the
    // hook MUST fire a German error toast (in addition to the existing
    // inline `qrError` UI) so the failure shows up in client telemetry.
    it("toasts the German error message via useAsyncMutation when the callable fails (#182)", async () => {
      mockToastError.mockReset()
      let isFirstCall = true
      mockCallableResult.mockImplementation(() => {
        if (isFirstCall) {
          isFirstCall = false
          return Promise.reject(new Error("qr fetch failed"))
        }
        return Promise.resolve({ data: { ok: true } })
      })

      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          onReset={() => {}}
          selectedMethod="ebanking"
        />,
      )

      await screen.findByText(/QR-Code konnte nicht geladen werden/)

      expect(mockToastError).toHaveBeenCalledWith(
        "QR-Code konnte nicht geladen werden",
      )
    })
  })

  // Regression test for issue #109: the Swiss cross overlay must match the
  // SIX QR-bill spec (white border, black square, white cross), not the
  // inverted arrangement that shipped previously.
  it("uses the spec-compliant Swiss cross color arrangement (white cross on black)", () => {
    const prefix = "data:image/svg+xml,"
    expect(SWISS_CROSS_SVG.startsWith(prefix)).toBe(true)

    const svg = decodeURIComponent(SWISS_CROSS_SVG.slice(prefix.length))

    expect(svg).toMatch(/<rect width="100" height="100" fill="white"\/>/)
    expect(svg).toMatch(/<rect x="3" y="3" width="94" height="94" fill="black"\/>/)
    expect(svg).toMatch(/<polygon points="[^"]+" fill="white"\/>/)

    expect(svg).not.toMatch(/<rect width="100" height="100" fill="black"\/>/)
    expect(svg).not.toMatch(/<polygon points="[^"]+" fill="black"\/>/)
  })
})
