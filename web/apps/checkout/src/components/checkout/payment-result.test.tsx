// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { vi, describe, it, expect, afterEach } from "vitest"

// Mock QR code component
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string; size: number }) => (
    <div data-testid="qrcode" data-value={props.value} />
  ),
}))

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Set env vars before dynamic import of component
import.meta.env.VITE_IBAN = "CH93 0076 2011 6238 5295 7"
import.meta.env.VITE_TWINT_URL = "https://twint.example.com/pay"
import.meta.env.VITE_PAYMENT_RECIPIENT_NAME = "Offene Werkstatt Wädenswil"
import.meta.env.VITE_PAYMENT_RECIPIENT_POSTAL_CODE = "8820"
import.meta.env.VITE_PAYMENT_RECIPIENT_CITY = "Wädenswil"
import.meta.env.VITE_PAYMENT_RECIPIENT_COUNTRY = "CH"
import.meta.env.VITE_CURRENCY = "CHF"

async function loadComponent() {
  const mod = await import("./payment-result")
  return mod.PaymentResult
}

describe("PaymentResult", () => {
  afterEach(() => {
    cleanup()
  })

  it('shows default "Zurück zum Start" when no resetLabel prop is provided', async () => {
    const PaymentResult = await loadComponent()
    render(<PaymentResult totalPrice={25} onReset={() => {}} />)
    expect(screen.getByRole("button", { name: "Zurück zum Start" })).toBeDefined()
  })

  it("shows custom resetLabel when provided", async () => {
    const PaymentResult = await loadComponent()
    render(
      <PaymentResult
        totalPrice={25}
        resetLabel="Zurück zum Besuch"
        onReset={() => {}}
      />,
    )
    expect(screen.getByRole("button", { name: "Zurück zum Besuch" })).toBeDefined()
    expect(screen.queryByText("Zurück zum Start")).toBeNull()
  })

  it("calls onReset when button is clicked", async () => {
    const PaymentResult = await loadComponent()
    const handleReset = vi.fn()
    render(<PaymentResult totalPrice={10} onReset={handleReset} />)

    await userEvent.click(screen.getByRole("button", { name: "Zurück zum Start" }))
    expect(handleReset).toHaveBeenCalledOnce()
  })

  it("displays the total price formatted as CHF", async () => {
    const PaymentResult = await loadComponent()
    render(<PaymentResult totalPrice={42.5} onReset={() => {}} />)
    expect(screen.getByText(/42.50/)).toBeDefined()
  })
})
