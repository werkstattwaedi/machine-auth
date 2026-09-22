// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #628: „Nur Materialbezug" is rejected by the server whenever the
 * cart holds a machine item, yet the Nutzungsart control offered it and the
 * submit then failed with a generic toast. With `hasMachineUsage` the option
 * stays visible but is disabled, explains why, and never fires `onChange`.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { UsageTypeSelect } from "./usage-type-select"
import { MATERIALBEZUG_MACHINE_REASON } from "@modules/lib/pricing"

afterEach(cleanup)

async function renderOpen(hasMachineUsage: boolean) {
  const onChange = vi.fn()
  render(
    <>
      <label htmlFor="usage-type">Nutzungsart</label>
      <UsageTypeSelect
        id="usage-type"
        value="regular"
        onChange={onChange}
        anonymous={false}
        hasMachineUsage={hasMachineUsage}
      />
    </>,
  )
  const user = userEvent.setup()
  await act(async () => {
    await user.click(screen.getByLabelText("Nutzungsart"))
  })
  return { user, onChange }
}

describe("UsageTypeSelect — machine usage disables Materialbezug (#628)", () => {
  it("renders Nur Materialbezug disabled with the reason and ignores clicks", async () => {
    const { user, onChange } = await renderOpen(true)

    const option = screen.getByRole("option", { name: "Nur Materialbezug" })
    expect(option).toHaveAttribute("aria-disabled", "true")
    expect(option.textContent).toContain(MATERIALBEZUG_MACHINE_REASON)
    // The reason replaces the price-effect line on that option only.
    expect(option.textContent).not.toContain(
      "Nutzungsgebühr wird nicht verrechnet",
    )
    expect(
      screen.getByRole("option", { name: "Hangenmoos AG" }).textContent,
    ).toContain("Nutzungsgebühr wird nicht verrechnet")

    await act(async () => {
      await user.click(option)
    })
    expect(onChange).not.toHaveBeenCalled()

    // Every other option is still selectable.
    for (const name of [
      "Ermässigte Nutzung (KulturLegi)",
      "Hangenmoos AG",
      "Freiwilligengruppe",
      "Interne Nutzung",
    ]) {
      expect(screen.getByRole("option", { name })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      )
    }
  })

  it("keeps Nur Materialbezug selectable without machine usage", async () => {
    const { user, onChange } = await renderOpen(false)

    const option = screen.getByRole("option", { name: "Nur Materialbezug" })
    expect(option).not.toHaveAttribute("aria-disabled", "true")
    expect(screen.queryByTestId("usage-type-disabled-reason")).toBeNull()

    await act(async () => {
      await user.click(option)
    })
    expect(onChange).toHaveBeenCalledWith("materialbezug")
  })
})
