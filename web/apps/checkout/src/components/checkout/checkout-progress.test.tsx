// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach } from "vitest"
import { CheckoutProgress } from "./checkout-progress"

afterEach(cleanup)

describe("CheckoutProgress step labels", () => {
  // Regression for #112: "Checkout" must be written as one word in the
  // user-visible step indicator (not "Check Out" or "Check-Out").
  it("renders step 3 as 'Checkout' (one word)", () => {
    render(<CheckoutProgress currentStep={0} />)
    expect(screen.getByText("3. Checkout")).toBeTruthy()
    expect(screen.queryByText("3. Check Out")).toBeNull()
    expect(screen.queryByText("3. Check-Out")).toBeNull()
  })

  it("renders step 1 as 'Check In' (not the outbound label)", () => {
    render(<CheckoutProgress currentStep={0} />)
    expect(screen.getByText("1. Check In")).toBeTruthy()
  })
})
