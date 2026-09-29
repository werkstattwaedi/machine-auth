// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * UnitQuantityField (issue #656):
 *   - the entry unit is an in-field suffix while typing a bare number and
 *     hides once the draft carries its own unit token ("50cm")
 *   - blur normalises to the entry unit ("120,5" → "120.5" cm, ".5m" → "50"),
 *     not to the "best" SI prefix
 *   - zero / empty after typing → "Bitte eine Zahl grösser als 0 eingeben"
 *   - an unknown unit keeps "Einheit unbekannt"
 *   - an untouched field stays quiet on blur
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import type { BaseUnit } from "@modules/lib/units"
import { UnitQuantityField } from "./unit-quantity-field"

const POSITIVE = "Bitte eine Zahl grösser als 0 eingeben"

function Harness({
  onChange,
  baseUnit = "m",
  defaultUnit = "cm",
  initial = 0,
}: {
  onChange: (v: number, error: string | null) => void
  baseUnit?: BaseUnit
  defaultUnit?: string
  initial?: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <UnitQuantityField
      value={value}
      onChange={(v, e) => {
        setValue(v)
        onChange(v, e)
      }}
      baseUnit={baseUnit}
      defaultUnit={defaultUnit}
      ariaLabel="Länge"
      errorId="form-errors"
    />
  )
}

function renderField(props: Omit<Parameters<typeof Harness>[0], "onChange"> = {}) {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} {...props} />)
  const input = screen.getByLabelText("Länge") as HTMLInputElement
  return { input, onChange }
}

/** The field itself only turns red; the message is the parent form's job
 *  (one full-width block under all fields), so no alert renders here. */
function expectFieldError(input: HTMLInputElement) {
  expect(input).toHaveAttribute("aria-invalid", "true")
  expect(input).toHaveAttribute("aria-describedby", "form-errors")
  expect(input.className).toContain("border-[#cc2a24]")
  expect(screen.queryByRole("alert")).toBeNull()
}

function expectFieldOk(input: HTMLInputElement) {
  expect(input).not.toHaveAttribute("aria-invalid")
  expect(input).not.toHaveAttribute("aria-describedby")
  expect(input.className).not.toContain("border-[#cc2a24]")
  expect(screen.queryByRole("alert")).toBeNull()
}

afterEach(cleanup)

describe("UnitQuantityField — unit suffix", () => {
  it("shows the entry unit next to a bare number", () => {
    const { input } = renderField()
    expect(screen.getByText("cm")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "50" } })
    expect(screen.getByText("cm")).toBeInTheDocument()
    expect(input.placeholder).toBe("0")
  })

  it("hides the suffix while the draft carries its own unit token", () => {
    const { input } = renderField()
    fireEvent.change(input, { target: { value: "50cm" } })
    expect(screen.queryByText("cm")).toBeNull()
    fireEvent.change(input, { target: { value: ".5m" } })
    expect(screen.queryByText("cm")).toBeNull()
  })
})

describe("UnitQuantityField — blur formatting", () => {
  it("keeps the entry unit: 120,5 → 120.5 (cm), value 1.205 m", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "120,5" } })
    fireEvent.blur(input)
    expect(input.value).toBe("120.5")
    expect(screen.getByText("cm")).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(1.205, null)
    expectFieldOk(input)
  })

  it("converts an explicit unit back into the entry unit: .5m → 50", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: ".5m" } })
    fireEvent.blur(input)
    expect(input.value).toBe("50")
    expect(screen.getByText("cm")).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(0.5, null)
  })

  it("does not switch to a bigger SI prefix: 1500 g stays 1500", () => {
    const { input, onChange } = renderField({ baseUnit: "kg", defaultUnit: "g" })
    fireEvent.change(input, { target: { value: "1500" } })
    fireEvent.blur(input)
    expect(input.value).toBe("1500")
    expect(onChange).toHaveBeenLastCalledWith(1.5, null)
  })

  it("renders a time entry in minutes: 1.5h → 90", () => {
    const { input, onChange } = renderField({ baseUnit: "h", defaultUnit: "min" })
    fireEvent.change(input, { target: { value: "1.5h" } })
    fireEvent.blur(input)
    expect(input.value).toBe("90")
    expect(onChange).toHaveBeenLastCalledWith(1.5, null)
  })

  it("initialises the draft from a committed value in the entry unit", () => {
    const { input } = renderField({ initial: 0.6 })
    expect(input.value).toBe("60")
  })
})

describe("UnitQuantityField — validation", () => {
  it("flags 0 on blur with the positive-number message", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)
    expectFieldError(input)
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(onChange).toHaveBeenLastCalledWith(0, POSITIVE)
  })

  it("flags a touched field that was cleared again", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)
    expectFieldError(input)
    expect(onChange).toHaveBeenLastCalledWith(0, POSITIVE)
  })

  it("stays quiet when an untouched empty field blurs", () => {
    const { input, onChange } = renderField()
    fireEvent.focus(input)
    fireEvent.blur(input)
    expectFieldOk(input)
    expect(onChange).toHaveBeenLastCalledWith(0, null)
  })

  it("keeps the unknown-unit message for unparseable text", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "5xyz" } })
    fireEvent.blur(input)
    expect(input.value).toBe("5xyz")
    expectFieldError(input)
    expect(onChange).toHaveBeenLastCalledWith(0, "Einheit unbekannt")
  })

  it("clears the error on the next keystroke and accepts a corrected value", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)
    expectFieldError(input)
    fireEvent.change(input, { target: { value: "60" } })
    expectFieldOk(input)
    expect(onChange).toHaveBeenLastCalledWith(0.6, null)
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(0.6, null)
    expect(input).not.toHaveAttribute("aria-invalid")
  })

  it("rejects keystrokes outside the number+unit pattern", () => {
    const { input } = renderField()
    fireEvent.change(input, { target: { value: "12" } })
    fireEvent.change(input, { target: { value: "12-" } })
    expect(input.value).toBe("12")
  })
})
