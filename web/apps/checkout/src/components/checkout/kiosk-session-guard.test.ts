// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk session guard — module-level bridge between the wizard (state
 * owner) and BridgeNfcRouter (tap-time consumer):
 *   - defaults to "nothing to protect, not identified, no name" when no
 *     wizard is mounted
 *   - reflects the registered getter live (preservable + identified + holder
 *     name)
 *   - unregister only clears its own registration (a newer guard wins)
 */

import { afterEach, describe, expect, it } from "vitest"
import {
  getKioskSessionState,
  isKioskSessionPreservable,
  registerKioskSessionGuard,
} from "./kiosk-session-guard"

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe("kiosk-session-guard", () => {
  it("defaults to not-preservable, not-identified, no holder name when no guard is registered", () => {
    expect(getKioskSessionState()).toEqual({
      preservable: false,
      identified: false,
      holderName: null,
    })
    expect(isKioskSessionPreservable()).toBe(false)
  })

  it("reflects the registered getter live", () => {
    let state = { preservable: false, identified: false, holderName: null }
    cleanup = registerKioskSessionGuard(() => state)
    expect(isKioskSessionPreservable()).toBe(false)
    state = { preservable: true, identified: false, holderName: null }
    expect(isKioskSessionPreservable()).toBe(true)
  })

  it("surfaces the identified flag and holder name through getKioskSessionState", () => {
    cleanup = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
    }))
    expect(getKioskSessionState()).toEqual({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
    })
  })

  it("unregistering restores the default", () => {
    const unregister = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: true,
      holderName: "Fritz Muster",
    }))
    expect(isKioskSessionPreservable()).toBe(true)
    unregister()
    expect(getKioskSessionState()).toEqual({
      preservable: false,
      identified: false,
      holderName: null,
    })
  })

  it("a stale unregister does not clear a newer guard", () => {
    const unregisterOld = registerKioskSessionGuard(() => ({
      preservable: false,
      identified: false,
      holderName: null,
    }))
    cleanup = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: false,
      holderName: null,
    }))
    unregisterOld()
    expect(isKioskSessionPreservable()).toBe(true)
  })
})
