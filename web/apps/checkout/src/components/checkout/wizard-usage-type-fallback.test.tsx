// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #628: a checkout already on „Nur Materialbezug" — rehydrated from
 * the open doc, or chosen before an NFC session synced in / manual hours
 * were added — must fall back to `regular` once a machine item is present,
 * because the server rejects that combination on close. Removing the last
 * machine item re-enables the option but does not re-apply the waiver.
 */

import { afterEach, describe, expect, it } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import { useState } from "react"
import type { UsageType } from "@modules/lib/pricing"
import { useUsageTypeFallback } from "./wizard-context"

afterEach(cleanup)

type Item = { id: string; type: "machine" | "material" | null }

const material: Item = { id: "i-material", type: "material" }
const machine: Item = { id: "i-machine", type: "machine" }

function useHarness(initial: UsageType, initialItems: Item[]) {
  const [usageType, setUsageType] = useState<UsageType>(initial)
  const [items, setItems] = useState<Item[]>(initialItems)
  useUsageTypeFallback(usageType, items, setUsageType)
  return { usageType, setUsageType, items, setItems }
}

describe("useUsageTypeFallback (#628)", () => {
  it("falls back to regular when a machine item appears while on materialbezug", () => {
    const { result } = renderHook(() => useHarness("materialbezug", [material]))
    expect(result.current.usageType).toBe("materialbezug")

    act(() => {
      result.current.setItems([material, machine])
    })
    expect(result.current.usageType).toBe("regular")
  })

  it("falls back immediately when rehydrated materialbezug meets existing machine items", () => {
    const { result } = renderHook(() => useHarness("regular", [machine]))
    // The „Sync usageType from open checkout" effect sets the stale value…
    act(() => {
      result.current.setUsageType("materialbezug")
    })
    // …and the fallback overrides it before it can be submitted.
    expect(result.current.usageType).toBe("regular")
  })

  it("does not re-apply the waiver when the last machine item is removed", () => {
    const { result } = renderHook(() =>
      useHarness("materialbezug", [material, machine]),
    )
    expect(result.current.usageType).toBe("regular")

    act(() => {
      result.current.setItems([material])
    })
    expect(result.current.usageType).toBe("regular")

    // The option is selectable again — the visitor re-selects it.
    act(() => {
      result.current.setUsageType("materialbezug")
    })
    expect(result.current.usageType).toBe("materialbezug")
  })

  it("leaves every other usage type alone with machine items present", () => {
    for (const ut of [
      "regular",
      "ermaessigt",
      "hangenmoos",
      "volunteering",
      "intern",
    ] as UsageType[]) {
      const { result, unmount } = renderHook(() => useHarness(ut, [machine]))
      expect(result.current.usageType, ut).toBe(ut)
      unmount()
    }
  })
})
