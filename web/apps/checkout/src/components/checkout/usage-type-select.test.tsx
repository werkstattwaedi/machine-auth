// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #605: each person picks a Nutzungsart on the check-in. The
 * owner-only types (Freiwilligengruppe, Interne Nutzung) are offered on the
 * identified person's own line only, and stay visible but disabled while
 * anyone else is on the visit.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { UsageTypeSelect } from "./usage-type-select"
import {
  OWNER_ONLY_OTHERS_REASON,
  USAGE_TYPE_LABELS,
  USAGE_TYPE_ORDER,
} from "@modules/lib/pricing"

afterEach(cleanup)

async function renderOpen(props: {
  isOwner: boolean
  anonymous?: boolean
  othersPresent?: boolean
}) {
  const onChange = vi.fn()
  render(
    <UsageTypeSelect
      id="usage-type"
      value="regular"
      onChange={onChange}
      ariaLabel="Nutzungsart"
      anonymous={props.anonymous ?? false}
      isOwner={props.isOwner}
      othersPresent={props.othersPresent ?? false}
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

describe("UsageTypeSelect (#605)", () => {
  it("lists every type, owner-only last, on the owner's line", async () => {
    await renderOpen({ isOwner: true })
    expect(optionNames()).toEqual(USAGE_TYPE_ORDER.map((t) => USAGE_TYPE_LABELS[t]))
    expect(optionNames().slice(-2)).toEqual([VOL, INTERN])
  })

  it("hides the owner-only types on another person's line", async () => {
    await renderOpen({ isOwner: false })
    expect(optionNames()).not.toContain(VOL)
    expect(optionNames()).not.toContain(INTERN)
  })

  it("hides the owner-only types for a guest check-in", async () => {
    await renderOpen({ isOwner: true, anonymous: true })
    expect(optionNames()).not.toContain(VOL)
  })

  it("disables the owner-only types while others are present", async () => {
    const { user, onChange } = await renderOpen({
      isOwner: true,
      othersPresent: true,
    })
    const option = screen.getByRole("option", { name: VOL })
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
