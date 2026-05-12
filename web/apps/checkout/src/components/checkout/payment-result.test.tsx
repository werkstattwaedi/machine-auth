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

// Mock the firestore mutation hook used to record the customer's
// payment-method acknowledgement on the checkout doc.
const mockAckUpdate = vi.fn()
vi.mock("@modules/hooks/use-firestore-mutation", () => ({
  useFirestoreMutation: () => ({
    update: mockAckUpdate,
    loading: false,
    error: null,
  }),
}))

vi.mock("firebase/firestore", () => ({
  serverTimestamp: () => "server-ts",
}))

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PaymentResult, SWISS_CROSS_SVG } from "./payment-result"

const PAYMENT_FIXTURE = {
  billId: "bill-1",
  checkoutId: "checkout-1",
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
    mockAckUpdate.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe("default — Rechnung tab selected", () => {
    it("shows the QR code and rechnung instructions on first render", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember={false}
          onReset={() => {}}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )

      // Hero shows the amount.
      expect(screen.getByText("Zu bezahlen")).toBeDefined()
      // QR + creditor block render.
      expect(screen.getByTestId("qrcode")).toBeDefined()
      expect(screen.getByText("Konto / Zahlbar an")).toBeDefined()
      expect(screen.getByText("CH56 0681 4580 1260 0509 7")).toBeDefined()
      expect(screen.getByText("Referenz")).toBeDefined()
      // PDF + IBAN copy buttons are part of the rechnung panel.
      // PDF download lives in the hero now (visible regardless of tab).
      expect(screen.getByRole("button", { name: /Rechnung als PDF/ })).toBeDefined()
    })

    it("uses the rechnung-specific commit label", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember={false}
          onReset={() => {}}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(
        screen.getByRole("button", {
          name: /Ich zahle die QR-Rechnung & Werkstatt verlassen/,
        }),
      ).toBeDefined()
    })

    it("does not render a back button (closed checkout — no rewind)", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember={false}
          onReset={() => {}}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.queryByRole("button", { name: /Zurück/ })).toBeNull()
    })
  })

  describe("Sammelrechnung gating", () => {
    it("hides the Sammelrechnung tab for non-members", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember={false}
          onReset={() => {}}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.queryByRole("tab", { name: /Sammelrechnung/ })).toBeNull()
    })

    it("shows the Sammelrechnung tab for members", () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember
          onReset={() => {}}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      expect(screen.getByRole("tab", { name: /Sammelrechnung/ })).toBeDefined()
    })

    it("switches to the monthly panel + commit label when the tab is clicked", async () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember
          onReset={() => {}}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      await userEvent.click(screen.getByRole("tab", { name: /Sammelrechnung/ }))
      // MonthlyPanel-only copy — the tab label also contains "Sammelrechnung",
      // so match on the unique panel sentence instead.
      expect(screen.getByText(/1\. des nächsten Monats/)).toBeDefined()
      expect(
        screen.getByRole("button", {
          name: /Auf Sammelrechnung setzen & Werkstatt verlassen/,
        }),
      ).toBeDefined()
      // QR code only renders for the rechnung tab.
      expect(screen.queryByTestId("qrcode")).toBeNull()
    })
  })

  describe("TWINT tab", () => {
    it("renders the TWINT pay-link and method-specific commit label", async () => {
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember={false}
          onReset={() => {}}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )
      await userEvent.click(screen.getByRole("tab", { name: /TWINT/ }))
      const link = screen.getByRole("link", { name: /Mit TWINT bezahlen/ })
      expect(link.getAttribute("href")).toBe("https://pay.raisenow.io/test")
      expect(
        screen.getByRole("button", {
          name: /Ich habe via TWINT bezahlt & Werkstatt verlassen/,
        }),
      ).toBeDefined()
      expect(screen.queryByTestId("qrcode")).toBeNull()
    })
  })

  describe("commit click → ack write → onReset", () => {
    it("writes the selected method to the checkout doc and then calls onReset", async () => {
      const handleReset = vi.fn()
      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember
          onReset={handleReset}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )

      await userEvent.click(screen.getByRole("tab", { name: /Sammelrechnung/ }))
      await userEvent.click(
        screen.getByRole("button", {
          name: /Auf Sammelrechnung setzen & Werkstatt verlassen/,
        }),
      )

      expect(mockAckUpdate).toHaveBeenCalledOnce()
      const [ref, payload] = mockAckUpdate.mock.calls[0]
      expect(ref.path).toBe("checkouts/checkout-1")
      expect(payload).toEqual({
        paymentMethodConfirmed: "monthly",
        paymentMethodConfirmedAt: "server-ts",
      })
      expect(handleReset).toHaveBeenCalledOnce()
    })

    it("does NOT call onReset when the ack write fails (lets the user retry)", async () => {
      const handleReset = vi.fn()
      mockAckUpdate.mockRejectedValueOnce(new Error("offline"))

      render(
        <PaymentResult
          checkoutId="checkout-1"
          totalPrice={25}
          isMember={false}
          onReset={handleReset}
          initialPaymentData={PAYMENT_FIXTURE}
        />,
      )

      await userEvent.click(
        screen.getByRole("button", {
          name: /Ich zahle die QR-Rechnung & Werkstatt verlassen/,
        }),
      )

      expect(mockAckUpdate).toHaveBeenCalledOnce()
      expect(handleReset).not.toHaveBeenCalled()
    })

    it("uses the checkoutId from PaymentData (the prop is decorative; the callable always threads it back)", async () => {
      const handleReset = vi.fn()
      render(
        <PaymentResult
          checkoutId={null}
          totalPrice={25}
          isMember={false}
          onReset={handleReset}
          initialPaymentData={{ ...PAYMENT_FIXTURE, checkoutId: "co-anon-9" }}
        />,
      )

      await userEvent.click(
        screen.getByRole("button", {
          name: /Ich zahle die QR-Rechnung & Werkstatt verlassen/,
        }),
      )

      const [ref] = mockAckUpdate.mock.calls[0]
      expect(ref.path).toBe("checkouts/co-anon-9")
      expect(handleReset).toHaveBeenCalledOnce()
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
          isMember={false}
          onReset={() => {}}
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
          isMember={false}
          onReset={() => {}}
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
          isMember={false}
          onReset={() => {}}
        />,
      )

      await screen.findByText(/QR-Code konnte nicht geladen werden/)

      expect(mockToastError).toHaveBeenCalledWith(
        "QR-Code konnte nicht geladen werden",
      )
    })
  })

  // Issue #237: when totalPrice is 0 (e.g. "Interne Nutzung") the screen
  // must hide the QR / Sammelrechnung / TWINT method picker and render a
  // dedicated "nichts zu bezahlen" message instead. The QR-load callable
  // must not fire because there's nothing to pay.
  describe("issue #237: zero-amount → 'nichts zu bezahlen' screen", () => {
    it("renders the kostenlos copy and hides all payment-method tabs at totalPrice=0", () => {
      render(
        <PaymentResult
          checkoutId="checkout-free"
          totalPrice={0}
          isMember
          onReset={() => {}}
        />,
      )

      // Friendly message — should contain "kostenlos" and the zero amount.
      expect(screen.getByText(/kostenlos/i)).toBeDefined()
      expect(screen.getByText("0.00")).toBeDefined()

      // No tabs: QR-Rechnung / Sammelrechnung / TWINT all hidden.
      expect(screen.queryByRole("tab", { name: /QR-Rechnung/ })).toBeNull()
      expect(screen.queryByRole("tab", { name: /Sammelrechnung/ })).toBeNull()
      expect(screen.queryByRole("tab", { name: /TWINT/ })).toBeNull()

      // No QR code.
      expect(screen.queryByTestId("qrcode")).toBeNull()

      // Method-specific commit labels are gone.
      expect(
        screen.queryByRole("button", {
          name: /Ich zahle die QR-Rechnung/,
        }),
      ).toBeNull()

      // The "Werkstatt verlassen" CTA is present.
      expect(
        screen.getByRole("button", { name: /Werkstatt verlassen/ }),
      ).toBeDefined()
    })

    it("calls onReset when the 'Werkstatt verlassen' button is clicked", async () => {
      const handleReset = vi.fn()
      render(
        <PaymentResult
          checkoutId="checkout-free"
          totalPrice={0}
          isMember={false}
          onReset={handleReset}
        />,
      )

      await userEvent.click(
        screen.getByRole("button", { name: /Werkstatt verlassen/ }),
      )
      expect(handleReset).toHaveBeenCalledOnce()
      // No ack write — there is no method to acknowledge.
      expect(mockAckUpdate).not.toHaveBeenCalled()
    })

    it("does not attempt to load QR payment data when totalPrice is 0", () => {
      // The callable that fetches QR/PayLink data is `getPaymentQrData`;
      // it must NOT be invoked for free visits. We don't pass
      // initialPaymentData, and we DO set a checkout.billRef in the
      // useDocument mock — without the zero-amount short-circuit the
      // component would call into mockCallableResult.
      mockUseDocument.mockImplementation((ref: { path?: string } | null) => {
        if (ref?.path?.startsWith("checkouts/")) {
          return {
            data: { id: "checkout-free", billRef: { id: "bill-free" } },
            loading: false,
            error: null,
          }
        }
        return { data: null, loading: false, error: null }
      })

      render(
        <PaymentResult
          checkoutId="checkout-free"
          totalPrice={0}
          isMember={false}
          onReset={() => {}}
        />,
      )

      expect(mockCallableResult).not.toHaveBeenCalled()
      expect(screen.getByText(/kostenlos/i)).toBeDefined()
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
