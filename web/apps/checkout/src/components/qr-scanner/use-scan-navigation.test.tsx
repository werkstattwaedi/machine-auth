// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useScanNavigation } from "./use-scan-navigation"

const navigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}))

beforeEach(() => {
  navigate.mockReset()
})

describe("useScanNavigation", () => {
  it("dispatches a price-list intent", () => {
    const { result } = renderHook(() => useScanNavigation())
    result.current({ kind: "list", listId: "abc123" })
    expect(navigate).toHaveBeenCalledWith({
      to: "/visit/add/list/$listId",
      params: { listId: "abc123" },
      replace: true,
    })
  })

  it("dispatches an item intent", () => {
    const { result } = renderHook(() => useScanNavigation())
    result.current({ kind: "item", code: "SKU-42" })
    expect(navigate).toHaveBeenCalledWith({
      to: "/visit/add/item/$code",
      params: { code: "SKU-42" },
      replace: true,
    })
  })

  it("dispatches an item-variant intent", () => {
    const { result } = renderHook(() => useScanNavigation())
    result.current({ kind: "itemVariant", code: "SKU-42", variantId: "v1" })
    expect(navigate).toHaveBeenCalledWith({
      to: "/visit/add/item/$code/$variantId",
      params: { code: "SKU-42", variantId: "v1" },
      replace: true,
    })
  })

  it("dispatches a workshop intent", () => {
    const { result } = renderHook(() => useScanNavigation())
    result.current({ kind: "workshop", workshopId: "holz" })
    expect(navigate).toHaveBeenCalledWith({
      to: "/visit/add/workshop/$workshopId",
      params: { workshopId: "holz" },
      replace: true,
    })
  })
})
