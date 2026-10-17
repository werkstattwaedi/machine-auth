// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #605 on the check-in: every person has their own Nutzungsart with
 * a live fee beside it; the owner-only types block adding persons; further
 * persons can't be a company; an identified session can keep a typed-in
 * person and pick saved ones.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useReducer } from "react"
import { StepCheckin } from "./step-checkin"
import {
  personsReducer,
  type CheckoutPerson,
  type SavedPersonEntry,
} from "./use-checkout-state"
import type { PricingConfig } from "@modules/lib/workshop-config"
import { USAGE_TYPE_LABELS, type UsageType } from "@modules/lib/pricing"
import { formatCHF } from "@modules/lib/format"

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

afterEach(cleanup)

const config: PricingConfig = {
  entryFees: {
    erwachsen: { regular: 15 },
    kind: { regular: 7.5 },
    firma: { regular: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: { units: {}, discounts: { none: "Normal", member: "Mitglied" } },
}

function self(usageType: UsageType = "regular"): CheckoutPerson {
  return {
    id: "p-self",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u-self",
    usageType,
  }
}

const guest: CheckoutPerson = {
  id: "p-guest",
  firstName: "Sara",
  lastName: "Brunner",
  email: "sara@example.com",
  userType: "erwachsen",
  termsAccepted: true,
  isPreFilled: false,
  usageType: "regular",
}

const mia: SavedPersonEntry = { id: "s-mia", firstName: "Mia", lastName: "Muster", userType: "kind" }

function Harness({
  initial,
  anonymous = false,
  savedPersons = [],
  waivedIds = [],
}: {
  initial: CheckoutPerson[]
  anonymous?: boolean
  savedPersons?: SavedPersonEntry[]
  /** Persons the same-day waiver preview marks as already billed today. */
  waivedIds?: string[]
}) {
  const [persons, dispatch] = useReducer(personsReducer, initial)
  return (
    <StepCheckin
      persons={persons}
      personsDispatch={dispatch}
      isAnonymous={anonymous}
      kiosk={false}
      isAccountLoggedIn={!anonymous}
      signedInUserId={anonymous ? null : "u-self"}
      ownerUserId={anonymous ? null : "u-self"}
      signedInEmail="max@example.com"
      config={config}
      feePersons={persons.map((p) =>
        waivedIds.includes(p.id) ? { ...p, entryFeeWaivedToday: true } : p,
      )}
      savedPersons={savedPersons}
      onDeleteSavedPerson={vi.fn().mockResolvedValue(undefined)}
    />
  )
}

async function chooseUsage(trigger: HTMLElement, type: UsageType) {
  const user = userEvent.setup()
  await act(async () => {
    await user.click(trigger)
  })
  await act(async () => {
    await user.click(screen.getByRole("option", { name: USAGE_TYPE_LABELS[type] }))
  })
}

const fees = () => screen.getAllByTestId("person-usage-fee").map((f) => f.textContent)

describe("StepCheckin — per-person Nutzungsart (#605)", () => {
  it("shows each person's live fee", async () => {
    render(<Harness initial={[self()]} />)
    expect(fees()).toEqual([formatCHF(15)])
    await chooseUsage(screen.getByTestId("usage-type-trigger"), "materialbezug")
    expect(fees()).toEqual([formatCHF(0)])
  })

  it("can't add persons while the owner has an owner-only type", () => {
    render(<Harness initial={[self("volunteering")]} />)
    expect(screen.getByRole("button", { name: /Person hinzufügen/ })).toBeDisabled()
  })

  it("can add persons on a regular owner line", () => {
    render(<Harness initial={[self()]} />)
    expect(screen.getByRole("button", { name: /Person hinzufügen/ })).not.toBeDisabled()
  })
})

describe("StepCheckin — user types of further persons (CHK-28)", () => {
  it("offers Firma only to the first person of a guest check-in", async () => {
    render(<Harness initial={[guest]} anonymous />)
    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))
    })
    const groups = screen.getAllByRole("radiogroup")
    expect(groups).toHaveLength(2)
    expect(within(groups[0]).getAllByRole("radio")).toHaveLength(3)
    expect(within(groups[1]).getAllByRole("radio")).toHaveLength(2)
  })
})

describe("StepCheckin — saved persons (#605)", () => {
  it("offers to save a typed-in person in an identified session", async () => {
    render(<Harness initial={[self()]} />)
    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))
    })
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
  })

  it("never offers saving in a guest check-in", async () => {
    render(<Harness initial={[guest]} anonymous />)
    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))
    })
    // Only the terms checkbox.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    expect(screen.getByRole("checkbox")).toHaveAttribute("id", "terms-accept")
  })

  it("adds a saved person as a strip and stops offering them", async () => {
    render(<Harness initial={[self()]} savedPersons={[mia]} />)
    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))
    })
    await act(async () => {
      await user.click(await screen.findByRole("menuitem", { name: "Mia Muster" }))
    })
    expect(screen.getAllByTestId("identity-strip")).toHaveLength(2)
    expect(screen.queryAllByTestId("person-card")).toHaveLength(0)
    // No save checkbox for a saved person; the fee follows their type.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    expect(fees()).toEqual([formatCHF(15), formatCHF(7.5)])
    // Mia is on the visit: the menu turns back into the plain button.
    expect(
      screen.getByRole("button", { name: /Person hinzufügen/ }),
    ).not.toHaveAttribute("aria-haspopup")
  })
})

describe("StepCheckin — same-day waiver (#776, CHK-39)", () => {
  it("shows a person already billed today at no fee, as Check Out does", () => {
    render(<Harness initial={[self(), guest]} waivedIds={["p-guest"]} />)
    expect(fees()).toEqual([formatCHF(15), formatCHF(0)])
    const waived = screen.getAllByTestId("person-usage-fee-waived-today")
    expect(waived).toHaveLength(1)
    expect(
      screen.getAllByTestId("person-usage-fee")[1].parentElement,
    ).toContainElement(waived[0])
  })

  it("shows the full fee and no hint without a waiver", () => {
    render(<Harness initial={[self(), guest]} />)
    expect(fees()).toEqual([formatCHF(15), formatCHF(15)])
    expect(screen.queryByTestId("person-usage-fee-waived-today")).toBeNull()
  })
})
