// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { FilterPills } from "./filter-pills"

// The admin vitest config has no global setup — clean up the DOM
// manually so queries don't see leftovers from the previous test.
afterEach(cleanup)

const OPTIONS = [
  { value: "all", label: "Alle" },
  { value: "open", label: "Offen", count: 3 },
  { value: "paid", label: "Bezahlt" },
] as const

type Value = (typeof OPTIONS)[number]["value"]

describe("FilterPills", () => {
  it("marks the active pill and shows counts", () => {
    render(
      <FilterPills<Value>
        options={[...OPTIONS]}
        value="open"
        onChange={() => {}}
      />,
    )
    expect(
      screen.getByRole("button", { name: /Offen/ }).getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: /Alle/ }).getAttribute("aria-pressed"),
    ).toBe("false")
    expect(
      screen.getByRole("button", { name: /Offen/ }).textContent,
    ).toContain("3")
  })

  it("reports pill clicks", async () => {
    const onChange = vi.fn()
    render(
      <FilterPills<Value>
        options={[...OPTIONS]}
        value="all"
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: /Bezahlt/ }))
    expect(onChange).toHaveBeenCalledWith("paid")
  })
})
