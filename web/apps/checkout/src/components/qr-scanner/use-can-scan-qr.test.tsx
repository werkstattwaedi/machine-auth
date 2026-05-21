// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useCanScanQr } from "./use-can-scan-qr"

interface FakeMql {
  matches: boolean
  addEventListener: (kind: string, cb: () => void) => void
  removeEventListener: (kind: string, cb: () => void) => void
  __fire: () => void
}

function fakeMatchMedia(initialMatches: boolean): FakeMql {
  const listeners = new Set<() => void>()
  return {
    matches: initialMatches,
    addEventListener: (_k, cb) => listeners.add(cb),
    removeEventListener: (_k, cb) => listeners.delete(cb),
    __fire: () => listeners.forEach((cb) => cb()),
  }
}

let originalMediaDevices: MediaDevices | undefined
let originalMatchMedia: typeof window.matchMedia

beforeEach(() => {
  originalMediaDevices = navigator.mediaDevices
  originalMatchMedia = window.matchMedia
})

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    value: originalMediaDevices,
    configurable: true,
  })
  window.matchMedia = originalMatchMedia
})

function setMediaDevices(value: Partial<MediaDevices> | undefined) {
  Object.defineProperty(navigator, "mediaDevices", {
    value,
    configurable: true,
  })
}

describe("useCanScanQr", () => {
  it("returns true on touch-coarse device with camera", () => {
    window.matchMedia = vi.fn(() => fakeMatchMedia(true)) as unknown as typeof window.matchMedia
    setMediaDevices({ getUserMedia: vi.fn() } as Partial<MediaDevices>)
    const { result } = renderHook(() => useCanScanQr())
    expect(result.current).toBe(true)
  })

  it("returns false when pointer is fine (laptop with mouse)", () => {
    window.matchMedia = vi.fn(() => fakeMatchMedia(false)) as unknown as typeof window.matchMedia
    setMediaDevices({ getUserMedia: vi.fn() } as Partial<MediaDevices>)
    const { result } = renderHook(() => useCanScanQr())
    expect(result.current).toBe(false)
  })

  it("returns false when there is no camera API", () => {
    window.matchMedia = vi.fn(() => fakeMatchMedia(true)) as unknown as typeof window.matchMedia
    setMediaDevices(undefined)
    const { result } = renderHook(() => useCanScanQr())
    expect(result.current).toBe(false)
  })

  it("returns false when both signals are off", () => {
    window.matchMedia = vi.fn(() => fakeMatchMedia(false)) as unknown as typeof window.matchMedia
    setMediaDevices(undefined)
    const { result } = renderHook(() => useCanScanQr())
    expect(result.current).toBe(false)
  })

  it("updates when the media-query result changes (e.g. fold/unfold)", () => {
    const mql = fakeMatchMedia(false)
    window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia
    setMediaDevices({ getUserMedia: vi.fn() } as Partial<MediaDevices>)
    const { result } = renderHook(() => useCanScanQr())
    expect(result.current).toBe(false)
    act(() => {
      mql.matches = true
      mql.__fire()
    })
    expect(result.current).toBe(true)
  })
})
