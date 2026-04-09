// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { PersonCard } from "./person-card"
import type { CheckoutPerson } from "./use-checkout-state"

afterEach(cleanup)

function makePerson(overrides: Partial<CheckoutPerson> = {}): CheckoutPerson {
  return {
    id: "test-1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "firma",
    termsAccepted: false,
    isPreFilled: false,
    billingCompany: "Muster AG",
    billingStreet: "Testweg 1",
    billingZip: "8000",
    billingCity: "Zürich",
    ...overrides,
  }
}

const noop = vi.fn()

describe("PersonCard billing address", () => {
  it("shows editable inputs when person is not pre-filled", () => {
    const person = makePerson({ isPreFilled: false })
    render(
      <PersonCard
        person={person}
        index={0}
        isOnly={true}
        showTerms={false}
        dispatch={noop}
      />,
    )

    // Billing inputs should be present
    const inputs = screen.getAllByDisplayValue("Muster AG")
    expect(inputs.length).toBe(1)
    expect(inputs[0].tagName).toBe("INPUT")

    expect(screen.getByDisplayValue("Testweg 1").tagName).toBe("INPUT")
    expect(screen.getByDisplayValue("8000").tagName).toBe("INPUT")
    expect(screen.getByDisplayValue("Zürich").tagName).toBe("INPUT")
  })

  it("shows read-only text when person is pre-filled", () => {
    const person = makePerson({ isPreFilled: true })
    render(
      <PersonCard
        person={person}
        index={0}
        isOnly={true}
        showTerms={false}
        dispatch={noop}
      />,
    )

    // Should show text, not inputs
    expect(screen.getByText("Muster AG")).toBeTruthy()
    expect(screen.getByText("Testweg 1")).toBeTruthy()
    expect(screen.getByText("8000")).toBeTruthy()
    expect(screen.getByText("Zürich")).toBeTruthy()

    // Should NOT have billing input fields
    expect(screen.queryByDisplayValue("Muster AG")).toBeNull()
    expect(screen.queryByDisplayValue("Testweg 1")).toBeNull()
    expect(screen.queryByDisplayValue("8000")).toBeNull()
    expect(screen.queryByDisplayValue("Zürich")).toBeNull()
  })
})
