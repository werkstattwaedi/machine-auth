// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The inline confirmation after the commit (issue #750): what each choice
 * reports, where the PDF and the QR slip appear, and that the PDF link
 * keeps asking while the PDF is still being made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { BILL_DOCUMENT_INFO } from "@oww/shared"
import { FirebaseProvider, type FirebaseServices } from "@modules/lib/firebase-context"

const mockCallable = vi.fn()
vi.mock("firebase/functions", () => ({
  httpsCallable: () => mockCallable,
  getFunctions: () => ({}),
}))
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: () => mockCallable,
}))
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}))

const { PaymentConfirmation } = await import("./payment-confirmation")
import {
  KASSE_EMAIL,
  PAYMENT_CHOICE_UI,
  type PaymentChoice,
  type PaymentData,
} from "./payment-methods"

const PAYMENT: PaymentData = {
  billId: "bill-1",
  checkoutId: "co-1",
  qrBillPayload: "SPC\n0200\n1",
  paylinkUrl: "https://pay.raisenow.io/abc?amount.values=25.00",
  creditor: { iban: "CH00 0000", name: "OWW", street: "", location: "8820 Wädenswil" },
  reference: "RF00 0000",
  payerName: "Max Muster",
  payerEmail: "max@test.com",
  amount: "25.00",
  currency: "CHF",
  paymentMethod: "rechnung",
}

function Wrapper({ children }: { children: ReactNode }) {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return <FirebaseProvider value={services}>{children}</FirebaseProvider>
}

function renderConfirmation(
  choice: PaymentChoice,
  opts: {
    email?: string
    ownDevice?: boolean
    isPhone?: boolean
    qrOpen?: boolean
    onQrOpenChange?: (open: boolean) => void
  } = {},
) {
  return render(
    <PaymentConfirmation
      choice={choice}
      amount={choice === "free" ? 0 : 42.5}
      paymentData={PAYMENT}
      copy={{ email: opts.email ?? "max@test.com", monthlyDate: "1. November" }}
      ownDevice={opts.ownDevice ?? true}
      isPhone={opts.isPhone ?? false}
      qrOpen={opts.qrOpen ?? false}
      onQrOpenChange={opts.onQrOpenChange ?? (() => {})}
      sleep={() => Promise.resolve()}
    />,
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  mockCallable.mockReset()
  mockToastError.mockReset()
})
afterEach(cleanup)

describe("PaymentConfirmation", () => {
  // The wording is the spec's and the design's business; this checks that
  // each choice reports a status and names the address the mail went to.
  it.each(["rechnung", "monthly", "raisenow"] as const)(
    "%s reports its status and where the mail went",
    (choice) => {
      renderConfirmation(choice)
      expect(screen.getByRole("status").textContent).not.toBe("")
      expect(screen.getByText("max@test.com")).toBeTruthy()
    },
  )

  it("without an e-mail address it claims no mail and says whom to contact", () => {
    renderConfirmation("rechnung", { email: "" })
    expect(screen.getByTestId("no-recipient")).toBeTruthy()
    expect(screen.getByRole("link", { name: KASSE_EMAIL })).toBeTruthy()
    cleanup()
    renderConfirmation("rechnung")
    expect(screen.queryByTestId("no-recipient")).toBeNull()
  })

  it("a free visit names the address its Beleg went to (CHK-23)", () => {
    renderConfirmation("free")
    expect(screen.getByRole("status").textContent).toBe(PAYMENT_CHOICE_UI.free.doneStatus)
    expect(screen.getByText("max@test.com")).toBeTruthy()
  })

  it("a free visit without an e-mail address warns about nothing (CHK-23)", () => {
    renderConfirmation("free", { email: "" })
    expect(screen.getByRole("status").textContent).toBe(PAYMENT_CHOICE_UI.free.doneStatus)
    expect(screen.queryByTestId("no-recipient")).toBeNull()
    expect(screen.queryByRole("link", { name: KASSE_EMAIL })).toBeNull()
  })

  it("a paid method without an e-mail address does not borrow the free visit's status", () => {
    renderConfirmation("rechnung", { email: "" })
    expect(screen.getByRole("status").textContent).not.toBe(
      PAYMENT_CHOICE_UI.free.doneStatus,
    )
  })

  it("offers the PDF on the own device only (BIL-15)", () => {
    renderConfirmation("rechnung", { ownDevice: true })
    expect(screen.getByRole("button", { name: /als PDF herunterladen/ })).toBeTruthy()
    cleanup()
    renderConfirmation("free", { ownDevice: false })
    expect(screen.queryByRole("button", { name: /als PDF herunterladen/ })).toBeNull()
  })

  // CHK-25: the link names the document the choice produced (BIL-8, #763).
  it.each([
    ["rechnung", "rechnung"],
    ["monthly", "beleg"],
    ["raisenow", "beleg"],
    ["free", "beleg"],
  ] as const)("after %s the PDF link names the %s", (choice, document) => {
    renderConfirmation(choice)
    const link = screen.getByRole("button", { name: /als PDF herunterladen/ })
    expect(link.textContent).toContain(BILL_DOCUMENT_INFO[document].label)
  })

  it("offers the QR slip after a QR-Rechnung, never on a phone, never for other methods", () => {
    renderConfirmation("rechnung")
    expect(screen.getByRole("button", { name: /QR-Code anzeigen/ })).toBeTruthy()
    cleanup()
    renderConfirmation("rechnung", { isPhone: true })
    expect(screen.queryByRole("button", { name: /QR-Code anzeigen/ })).toBeNull()
    cleanup()
    renderConfirmation("monthly")
    expect(screen.queryByRole("button", { name: /QR-Code anzeigen/ })).toBeNull()
  })

  it("the QR disclosure reports its toggle and shows the slip when open", () => {
    const onQrOpenChange = vi.fn()
    renderConfirmation("rechnung", { onQrOpenChange })
    expect(screen.queryByTestId("payment-qr")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /QR-Code anzeigen/ }))
    expect(onQrOpenChange).toHaveBeenCalledWith(true)
    cleanup()
    renderConfirmation("rechnung", { qrOpen: true })
    expect(screen.getByTestId("payment-qr")).toBeTruthy()
  })

  it("after TWINT, says whom to contact if the payment did not go through", () => {
    renderConfirmation("raisenow")
    const contact = screen.getByRole("link", { name: KASSE_EMAIL })
    expect(contact.getAttribute("href")).toBe(`mailto:${KASSE_EMAIL}`)
    cleanup()
    renderConfirmation("rechnung")
    expect(screen.queryByRole("link", { name: KASSE_EMAIL })).toBeNull()
  })

  it("keeps the paylink at hand after TWINT, in case its window did not open", () => {
    renderConfirmation("raisenow")
    const link = screen.getByRole("link", { name: /TWINT-Zahlung nochmals öffnen/ })
    expect(link.getAttribute("href")).toBe(PAYMENT.paylinkUrl)
  })

  it("the PDF link keeps asking while the PDF is still being made", async () => {
    const notYet = Object.assign(new Error("PDF not yet generated"), {
      code: "functions/failed-precondition",
    })
    mockCallable
      .mockRejectedValueOnce(notYet)
      .mockRejectedValueOnce(notYet)
      .mockResolvedValueOnce({ data: { url: "https://storage.example/bill.pdf" } })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    renderConfirmation("rechnung")
    fireEvent.click(screen.getByRole("button", { name: /als PDF herunterladen/ }))

    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    const asks = mockCallable.mock.calls.filter(([arg]) => arg?.billId === "bill-1")
    expect(asks).toHaveLength(3)
    expect(mockToastError).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it("the PDF link gives up on any other error with the hook's toast", async () => {
    mockCallable.mockRejectedValue(
      Object.assign(new Error("denied"), { code: "functions/permission-denied" }),
    )
    renderConfirmation("rechnung")
    fireEvent.click(screen.getByRole("button", { name: /als PDF herunterladen/ }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    // One ask for the URL (the other call is the hook's error telemetry).
    const asks = mockCallable.mock.calls.filter(([arg]) => arg?.billId === "bill-1")
    expect(asks).toHaveLength(1)
  })
})
