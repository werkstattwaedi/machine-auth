// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The Check Out route's commit (issue #750): which method goes with the
 * close, the TWINT window opened inside the click and pointed at the
 * paylink once the close answers, and the switch to the confirmation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

let CapturedComponent: (() => React.JSX.Element) | null = null
const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  useNavigate: () => mockNavigate,
  useLocation: () => false,
}))

const mockUseWizardContext = vi.fn()
vi.mock("@/components/checkout/wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

let bridgeAvailable = false
let paymentConfirmed: (() => void) | null = null
const bridgeStub = {
  get available() {
    return bridgeAvailable
  },
  onPaymentConfirmed: (cb: () => void) => {
    paymentConfirmed = cb
    return () => {}
  },
}
vi.mock("@modules/lib/use-bridge", () => ({
  useBridge: () => bridgeStub,
}))

type StepProps = {
  paymentMethods: string[]
  onCommit: (choice: string) => Promise<void>
}
let stepProps: StepProps | null = null
vi.mock("@/components/checkout/step-checkout", () => ({
  StepCheckout: (props: StepProps) => {
    stepProps = props
    return <div data-testid="step-checkout" />
  },
}))
vi.mock("@/components/checkout/payment-confirmation", () => ({
  PaymentConfirmation: ({
    choice,
    onQrOpenChange,
  }: {
    choice: string
    onQrOpenChange: (open: boolean) => void
  }) => (
    <div>
      <div data-testid="confirmation">{choice}</div>
      <button onClick={() => onQrOpenChange(true)}>qr-open</button>
      <button onClick={() => onQrOpenChange(false)}>qr-close</button>
    </div>
  ),
}))
let finishHeld: boolean | null = null
let finishSignedIn: boolean | null = null
vi.mock("@/components/checkout/checkout-finish-bar", () => ({
  CheckoutFinishBar: ({
    holdCountdown,
    signedIn,
    onFinish,
  }: {
    holdCountdown: boolean
    signedIn: boolean
    onFinish: () => void
  }) => {
    finishHeld = holdCountdown
    finishSignedIn = signedIn
    return <button onClick={onFinish}>finish</button>
  },
}))

await import("./checkout")

const PAYMENT = {
  billId: "bill-1",
  checkoutId: "co-1",
  qrBillPayload: "SPC",
  paylinkUrl: "https://pay.raisenow.io/abc",
  creditor: { iban: "", name: "", street: "", location: "" },
  reference: "",
  payerName: "",
  payerEmail: "max@test.com",
  amount: "25.00",
  currency: "CHF",
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    persons: [],
    isAnonymous: false,
    usageType: "regular",
    setUsageType: () => {},
    tip: 0,
    setTip: () => {},
    items: [],
    pricingConfig: null,
    membershipCatalogId: null,
    badgeCatalogId: null,
    personsDispatch: () => {},
    identifiedUserDoc: null,
    submitting: false,
    submitError: null,
    paymentChoice: null,
    setPaymentChoice: () => {},
    paymentData: null,
    kiosk: false,
    isMember: false,
    isAccountLoggedIn: true,
    submitCheckout: vi.fn(async () => PAYMENT),
    startOver: vi.fn(),
    ...overrides,
  }
}

function renderRoute() {
  const Component = CapturedComponent!
  return render(<Component />)
}

beforeEach(() => {
  stepProps = null
  bridgeAvailable = false
  paymentConfirmed = null
  finishHeld = null
  finishSignedIn = null
  mockNavigate.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Check Out route — commit (#750)", () => {
  it("closes with the chosen method; a free visit closes without one", async () => {
    const c = ctx()
    mockUseWizardContext.mockReturnValue(c)
    renderRoute()

    await stepProps!.onCommit("rechnung")
    expect(c.submitCheckout).toHaveBeenLastCalledWith("rechnung")
    await stepProps!.onCommit("free")
    expect(c.submitCheckout).toHaveBeenLastCalledWith(undefined)
  })

  it("TWINT: opens the window inside the click, then points it at the paylink", async () => {
    let answer: (data: typeof PAYMENT) => void = () => {}
    const c = ctx({
      submitCheckout: vi.fn(
        () => new Promise<typeof PAYMENT>((resolve) => (answer = resolve)),
      ),
    })
    mockUseWizardContext.mockReturnValue(c)
    const popup = {
      document: { write: vi.fn(), close: vi.fn() },
      location: { href: "" },
      opener: {} as unknown,
      close: vi.fn(),
    }
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window)
    renderRoute()

    const committing = stepProps!.onCommit("raisenow")
    // Opened before the close answered: still inside the user's click.
    expect(open).toHaveBeenCalledOnce()
    expect(c.submitCheckout).toHaveBeenCalledWith("raisenow")

    answer(PAYMENT)
    await committing
    expect(popup.location.href).toBe(PAYMENT.paylinkUrl)
    expect(popup.opener).toBeNull()
  })

  it("TWINT: a failed close shuts the blank window again", async () => {
    const c = ctx({ submitCheckout: vi.fn(async () => null) })
    mockUseWizardContext.mockReturnValue(c)
    const popup = { document: { write: vi.fn(), close: vi.fn() }, location: { href: "" }, close: vi.fn() }
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window)
    renderRoute()

    await stepProps!.onCommit("raisenow")
    expect(popup.close).toHaveBeenCalledOnce()
  })

  it("TWINT at the kiosk: no blank window; the paylink opens after the close (overlay)", async () => {
    bridgeAvailable = true
    const c = ctx({ kiosk: true })
    mockUseWizardContext.mockReturnValue(c)
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    renderRoute()

    await stepProps!.onCommit("raisenow")
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][0]).toBe(PAYMENT.paylinkUrl)
  })

  it("once committed, shows the confirmation of the method the server names", async () => {
    mockUseWizardContext.mockReturnValue(
      ctx({
        paymentChoice: "monthly",
        // A retry after a lost answer: the server kept the first method.
        paymentData: { ...PAYMENT, paymentMethod: "rechnung" },
      }),
    )
    await act(async () => {
      renderRoute()
    })
    expect(screen.queryByTestId("step-checkout")).toBeNull()
    expect(screen.getByTestId("confirmation").textContent).toBe("rechnung")
  })

  it("kiosk: an unfolded QR slip holds the countdown, also once folded again", async () => {
    bridgeAvailable = true
    mockUseWizardContext.mockReturnValue(
      ctx({ kiosk: true, paymentChoice: "rechnung", paymentData: { ...PAYMENT, paymentMethod: "rechnung" } }),
    )
    renderRoute()
    expect(finishHeld).toBe(false)
    act(() => screen.getByText("qr-open").click())
    act(() => screen.getByText("qr-close").click())
    expect(finishHeld).toBe(true)
  })

  it("kiosk TWINT: no countdown while the overlay payment runs; it starts once the overlay reports it", () => {
    bridgeAvailable = true
    mockUseWizardContext.mockReturnValue(
      ctx({ kiosk: true, paymentChoice: "raisenow", paymentData: { ...PAYMENT, paymentMethod: "raisenow" } }),
    )
    renderRoute()
    expect(finishHeld).toBe(true)
    act(() => paymentConfirmed!())
    expect(finishHeld).toBe(false)
  })

  it("finish: the kiosk hands over with the strong reset", async () => {
    bridgeAvailable = true
    const c = ctx({ kiosk: true, paymentChoice: "rechnung", paymentData: { ...PAYMENT, paymentMethod: "rechnung" } })
    mockUseWizardContext.mockReturnValue(c)
    renderRoute()
    await act(async () => screen.getByText("finish").click())
    expect(c.startOver).toHaveBeenCalledOnce()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("finish: signed in on an own device goes to the past visits, no reset", async () => {
    const c = ctx({ paymentChoice: "rechnung", paymentData: { ...PAYMENT, paymentMethod: "rechnung" } })
    mockUseWizardContext.mockReturnValue(c)
    renderRoute()
    expect(finishSignedIn).toBe(true)
    await act(async () => screen.getByText("finish").click())
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/account/usage" })
    expect(c.startOver).not.toHaveBeenCalled()
  })

  it("a bill the server closed at CHF 0 confirms as free, whatever was chosen (BIL-8)", async () => {
    mockUseWizardContext.mockReturnValue(
      ctx({ paymentChoice: "rechnung", paymentData: { ...PAYMENT, amount: "0.00", paymentMethod: null } }),
    )
    await act(async () => {
      renderRoute()
    })
    expect(screen.getByTestId("confirmation").textContent).toBe("free")
  })

  it("a guest's finish bar knows they are not signed in", () => {
    mockUseWizardContext.mockReturnValue(
      ctx({ isAccountLoggedIn: false, paymentChoice: "rechnung", paymentData: { ...PAYMENT, paymentMethod: "rechnung" } }),
    )
    renderRoute()
    expect(finishSignedIn).toBe(false)
  })
})
