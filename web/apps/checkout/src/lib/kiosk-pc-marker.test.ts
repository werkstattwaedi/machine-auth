// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  KIOSK_PC_STORAGE_KEY,
  kioskPcParamAction,
  resolveKioskPcMarker,
  withoutKioskPcParam,
} from "./kiosk-pc-marker"

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

describe("kioskPcParamAction", () => {
  it("reads only the exact values 1 and 0", () => {
    expect(kioskPcParamAction("?kiosk-pc=1")).toBe("arm")
    expect(kioskPcParamAction("?kiosk-pc=0")).toBe("disarm")
    for (const search of ["?kiosk-pc", "?kiosk-pc=", "?kiosk-pc=off", "?kiosk-pc=true", "?kiosk", ""]) {
      expect(kioskPcParamAction(search), search).toBeNull()
    }
  })
})

describe("withoutKioskPcParam", () => {
  it("drops only the kiosk-pc parameter", () => {
    expect(withoutKioskPcParam("?kiosk-pc=1")).toBe("")
    expect(withoutKioskPcParam("?a=1&kiosk-pc=0&b=2")).toBe("?a=1&b=2")
    expect(withoutKioskPcParam("")).toBe("")
  })
})

describe("resolveKioskPcMarker", () => {
  it("arms the browser and keeps it armed on later visits", () => {
    const storage = memoryStorage()
    expect(resolveKioskPcMarker("?kiosk-pc=1", storage)).toEqual({
      marked: true,
      action: "arm",
    })
    expect(resolveKioskPcMarker("", storage)).toEqual({
      marked: true,
      action: null,
    })
  })

  it("disarms the browser", () => {
    const storage = memoryStorage({ [KIOSK_PC_STORAGE_KEY]: "1" })
    expect(resolveKioskPcMarker("?kiosk-pc=0", storage).marked).toBe(false)
    expect(storage.data.has(KIOSK_PC_STORAGE_KEY)).toBe(false)
  })

  it("leaves an unmarked browser alone", () => {
    expect(resolveKioskPcMarker("?foo=1", memoryStorage()).marked).toBe(false)
  })

  it("treats unusable storage as unmarked", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
      removeItem: () => {},
    }
    expect(resolveKioskPcMarker("?kiosk-pc=1", throwing).marked).toBe(false)
    expect(resolveKioskPcMarker("", undefined).marked).toBe(false)
  })
})
