// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, afterEach, vi } from "vitest"
import { useState } from "react"
import { SpendeCard } from "./step-checkout"

afterEach(cleanup)

/**
 * Wrapper that mirrors the parent's `manualTip` numeric state, so we exercise
 * the same controlled-input contract `StepCheckout` uses.
 */
function Harness({ onChange }: { onChange?: (v: number) => void }) {
  const [spende, setSpende] = useState(0)
  return (
    <SpendeCard
      spende={spende}
      onSpendeChange={(v) => {
        setSpende(v)
        onChange?.(v)
      }}
      roundUpEnabled={false}
      roundUpBase={0}
      roundUpOptions={[]}
      roundUpTarget={null}
      roundUpDelta={0}
      onRoundUpToggle={() => {}}
      onRoundUpTarget={() => {}}
    />
  )
}

describe("SpendeCard input", () => {
  it("accepts trailing digits like '20' without truncating to '2'", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    const input = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    await user.type(input, "20")

    // The bug: previous behaviour reformatted "2" -> "2.00" on each
    // keystroke, blocking the "0".
    expect(input.value).toBe("20")
    expect(onChange).toHaveBeenLastCalledWith(20)
  })

  it("accepts a decimal point and partial fraction during typing", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    const input = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    await user.type(input, "0.5")

    expect(input.value).toBe("0.5")
    expect(onChange).toHaveBeenLastCalledWith(0.5)
  })

  it("normalizes to two decimals on blur", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    await user.type(input, "20")
    expect(input.value).toBe("20")

    // Tab away to trigger blur.
    await user.tab()
    expect(input.value).toBe("20.00")
  })

  it("accepts comma as decimal separator", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    const input = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    await user.type(input, "1,5")

    expect(input.value).toBe("1,5")
    expect(onChange).toHaveBeenLastCalledWith(1.5)
  })

  it("clears to empty on blur when value is zero", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    await user.type(input, "0")
    await user.tab()
    expect(input.value).toBe("")
  })
})
