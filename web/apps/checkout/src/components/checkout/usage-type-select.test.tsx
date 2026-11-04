// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #605: each person picks a Nutzungsart on the check-in. The group
 * types (Freiwilligengruppe, Interne Nutzung) are offered on the identified
 * person's own line only, by their Workspace groups (CHK-51); Interne
 * Nutzung stays visible but disabled while anyone else is on the visit
 * (CHK-52).
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { UsageTypeSelect } from "./usage-type-select"
import {
  OWNER_ONLY_OTHERS_REASON,
  USAGE_TYPE_LABELS,
  USAGE_TYPE_ORDER,
  type UsageGroup,
  type UsageType,
} from "@modules/lib/pricing"

afterEach(cleanup)

async function renderOpen(props: {
  isOwner: boolean
  anonymous?: boolean
  othersPresent?: boolean
  ownerGroups?: UsageGroup[]
  value?: UsageType
}) {
  const onChange = vi.fn()
  render(
    <UsageTypeSelect
      id="usage-type"
      value={props.value ?? "regular"}
      onChange={onChange}
      ariaLabel="Nutzungsart"
      anonymous={props.anonymous ?? false}
      isOwner={props.isOwner}
      othersPresent={props.othersPresent ?? false}
      ownerGroups={props.ownerGroups ?? []}
    />,
  )
  const user = userEvent.setup()
  await act(async () => {
    await user.click(screen.getByLabelText("Nutzungsart"))
  })
  return { user, onChange }
}

const VOL = USAGE_TYPE_LABELS.volunteering
const INTERN = USAGE_TYPE_LABELS.intern

function optionNames(): string[] {
  return screen
    .getAllByRole("option")
    .map((o) => o.querySelector("span")?.textContent ?? "")
}

describe("UsageTypeSelect (#605, CHK-51)", () => {
  it("hides the group types from an owner in no group", async () => {
    await renderOpen({ isOwner: true })
    expect(optionNames()).toEqual(
      USAGE_TYPE_ORDER.filter((t) => t !== "volunteering" && t !== "intern").map(
        (t) => USAGE_TYPE_LABELS[t],
      ),
    )
  })

  it("adds Interne Nutzung, last, for the intern group", async () => {
    await renderOpen({ isOwner: true, ownerGroups: ["intern"] })
    expect(optionNames().at(-1)).toBe(INTERN)
    expect(optionNames()).not.toContain(VOL)
  })

  it("offers a volunteer only the group types", async () => {
    await renderOpen({
      isOwner: true,
      ownerGroups: ["volunteering", "intern"],
      value: "volunteering",
    })
    expect(optionNames()).toEqual([VOL, INTERN])
  })

  it("hides the group types on another person's line", async () => {
    await renderOpen({ isOwner: false, ownerGroups: ["volunteering", "intern"] })
    expect(optionNames()).not.toContain(VOL)
    expect(optionNames()).not.toContain(INTERN)
  })

  it("hides the group types for a guest check-in", async () => {
    await renderOpen({ isOwner: true, anonymous: true, ownerGroups: ["volunteering"] })
    expect(optionNames()).not.toContain(VOL)
  })

  it("keeps Freiwilligengruppe selectable next to visitors", async () => {
    await renderOpen({ isOwner: true, othersPresent: true, ownerGroups: ["volunteering"] })
    expect(screen.getByRole("option", { name: VOL })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    )
  })

  it("disables Interne Nutzung while others are present", async () => {
    const { user, onChange } = await renderOpen({
      isOwner: true,
      othersPresent: true,
      ownerGroups: ["intern"],
    })
    const option = screen.getByRole("option", { name: INTERN })
    expect(option).toHaveAttribute("aria-disabled", "true")
    expect(option.textContent).toContain(OWNER_ONLY_OTHERS_REASON)
    await act(async () => {
      await user.click(option)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("selects a type", async () => {
    const { user, onChange } = await renderOpen({ isOwner: false })
    await act(async () => {
      await user.click(
        screen.getByRole("option", { name: USAGE_TYPE_LABELS.materialbezug }),
      )
    })
    expect(onChange).toHaveBeenCalledWith("materialbezug")
  })
})
