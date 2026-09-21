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

// Issue #663: every input must carry an accessible name that includes the
// card ("Person 2 Vorname"), so assistive tech and `getByLabel` can tell the
// guests apart. The card number is a visually-hidden prefix inside the label.
describe("PersonCard accessible names", () => {
  it("associates each editable field with a card-scoped label", () => {
    render(
      <PersonCard
        person={makePerson({ isPreFilled: false })}
        index={1}
        showTerms={false}
        dispatch={noop}
      />,
    )

    const firstName = screen.getByLabelText(/Person 2 Vorname/)
    expect(firstName.tagName).toBe("INPUT")
    expect((firstName as HTMLInputElement).value).toBe("Max")

    expect(screen.getByLabelText(/Person 2 Nachname/).tagName).toBe("INPUT")
    expect(screen.getByLabelText(/Person 2 E-Mail/).tagName).toBe("INPUT")

    // Firma billing address fields are scoped the same way.
    expect(
      (screen.getByLabelText(/Person 2 Firma\*/) as HTMLInputElement).value,
    ).toBe("Muster AG")
    expect(screen.getByLabelText(/Person 2 Strasse/).tagName).toBe("INPUT")
    expect(screen.getByLabelText(/Person 2 PLZ/).tagName).toBe("INPUT")
    expect(screen.getByLabelText(/Person 2 Ort/).tagName).toBe("INPUT")

    // The radio group is named by its visible "Nutzer:in" label.
    expect(
      screen.getByRole("radiogroup", { name: /Person 2 Nutzer:in/ }),
    ).toBeTruthy()
  })

  it("keeps ids unique across cards so labels never cross-wire", () => {
    render(
      <>
        <PersonCard
          person={makePerson({ id: "a", firstName: "Anna", userType: "erwachsen" })}
          index={0}
          showTerms={false}
          dispatch={noop}
        />
        <PersonCard
          person={makePerson({ id: "b", firstName: "Ben", userType: "erwachsen" })}
          index={1}
          showTerms={false}
          dispatch={noop}
        />
      </>,
    )

    const first = screen.getByLabelText(/Person 1 Vorname/) as HTMLInputElement
    const second = screen.getByLabelText(/Person 2 Vorname/) as HTMLInputElement
    expect(first.value).toBe("Anna")
    expect(second.value).toBe("Ben")
    expect(first.id).not.toBe(second.id)
  })
})
