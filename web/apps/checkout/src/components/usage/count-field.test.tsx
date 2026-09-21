// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * CountField (issue #656) — integer count input for Stk. / Layer:
 *   - only digits can be typed, so "1.5" never becomes a value
 *   - zero / empty after the user touched the field → inline message + hasError
 *   - an untouched field stays quiet on blur (autofocused empty field on open)
 *   - a valid count reports (n, false) and normalises leading zeros
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
  onChange: (v: number, hasError: boolean) => void
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
    />
  )
}

function renderField(initial = 0) {
  const onChange = vi.fn()
  render(<Harness onChange={onChange} initial={initial} />)
  const input = screen.getByLabelText("Anzahl") as HTMLInputElement
  return { input, onChange }
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
    expect(onChange).toHaveBeenLastCalledWith(1, false)
  })

  it("rejects letters and signs", () => {
    const { input } = renderField()
    fireEvent.change(input, { target: { value: "abc" } })
    expect(input.value).toBe("")
    fireEvent.change(input, { target: { value: "-3" } })
    expect(input.value).toBe("")
  })

  it("shows the positive-number message for 0 on blur and reports hasError", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)
    expect(screen.getByRole("alert")).toHaveTextContent(POSITIVE)
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(onChange).toHaveBeenLastCalledWith(0, true)
  })

  it("shows the message when a touched field is cleared", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.blur(input)
    expect(screen.getByRole("alert")).toHaveTextContent(POSITIVE)
    expect(onChange).toHaveBeenLastCalledWith(0, true)
  })

  it("stays quiet when an untouched empty field blurs", () => {
    const { input, onChange } = renderField()
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith(0, false)
  })

  it("reports a valid count and clears a prior error on edit", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "0" } })
    fireEvent.blur(input)
    expect(screen.getByRole("alert")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "3" } })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith(3, false)
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(3, false)
    expect(input).not.toHaveAttribute("aria-invalid")
  })

  it("normalises leading zeros on blur", () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, { target: { value: "007" } })
    fireEvent.blur(input)
    expect(input.value).toBe("7")
    expect(onChange).toHaveBeenLastCalledWith(7, false)
  })

  it("uses the numeric keypad hint and stays a text input", () => {
    const { input } = renderField()
    expect(input).toHaveAttribute("type", "text")
    expect(input).toHaveAttribute("inputmode", "numeric")
  })
})
