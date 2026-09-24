// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * CountField (issue #656) — integer count input for Stk. / Layer:
 *   - only digits can be typed, so "1.5" never becomes a value
 *   - zero / empty after the user touched the field → red border and
 *     onChange(0, message); the message renders at form level, not here
 *   - an untouched field stays quiet on blur (autofocused empty field on open)
 *   - a valid count reports (n, null) and normalises leading zeros
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { CountField } from "./count-field"

const POSITIVE = "Bitte eine Zahl grösser als 0 eingeben"

/** Parent-owned value, like the picker forms. */
function Harness({
  onChange,
  initial = 0,
}: {
  onChange: (v: number, error: string | null) => void
  initial?: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <CountField
      value={value}
      onChange={(v, e) => {
        setValue(v)
        onChange(v, e)
      }}
      ariaLabel="Anzahl"
      errorId="form-errors"
    />
  )
}

function renderField(initial = 0) {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} initial={initial} />)
  const input = screen.getByLabelText("Anzahl") as HTMLInputElement
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

describe("CountField", () => {
  it("rejects a decimal separator so 1.5 cannot be entered", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "1" } })
    expect(input.value).toBe("1")
    fireEvent.change(input, { target: { value: "1.5" } })
    expect(input.value).toBe("1")
    fireEvent.change(input, { target: { value: "1,5" } })
    expect(input.value).toBe("1")
    expect(onChange).toHaveBeenLastCalledWith(1, null)
  })

  it("rejects letters and signs", () => {
    const { input } = renderField()
    fireEvent.change(input, { target: { value: "abc" } })
    expect(input.value).toBe("")
    fireEvent.change(input, { target: { value: "-3" } })
    expect(input.value).toBe("")
  })

  it("shows the positive-number message for 0 on blur and reports it upward", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)
    expectFieldError(input)
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(onChange).toHaveBeenLastCalledWith(0, POSITIVE)
  })

  it("shows the message when a touched field is cleared", () => {
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

  it("reports a valid count and clears a prior error on edit", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)
    expectFieldError(input)
    fireEvent.change(input, { target: { value: "3" } })
    expectFieldOk(input)
    expect(onChange).toHaveBeenLastCalledWith(3, null)
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(3, null)
    expect(input).not.toHaveAttribute("aria-invalid")
  })

  it("normalises leading zeros on blur", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "007" } })
    fireEvent.blur(input)
    expect(input.value).toBe("7")
    expect(onChange).toHaveBeenLastCalledWith(7, null)
  })

  it("uses the numeric keypad hint and stays a text input", () => {
    const { input } = renderField()
    expect(input).toHaveAttribute("type", "text")
    expect(input).toHaveAttribute("inputmode", "numeric")
  })
})
