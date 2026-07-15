// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk session guard — module-level bridge between the wizard (state
 * owner) and BridgeNfcRouter (tap-time consumer):
 *   - defaults to "nothing to protect, not identified, no name, no badges"
 *     when no wizard is mounted
 *   - reflects the registered getter live (preservable + identified + holder
 *     name + badge token ids)
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
  it("defaults to not-preservable, not-identified, no holder name, no badges when no guard is registered", () => {
    expect(getKioskSessionState()).toEqual({
      preservable: false,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    })
    expect(isKioskSessionPreservable()).toBe(false)
  })

  it("reflects the registered getter live", () => {
    let state = {
      preservable: false,
      identified: false,
      holderName: null,
      badgeTokenIds: [] as string[],
    }
    cleanup = registerKioskSessionGuard(() => state)
    expect(isKioskSessionPreservable()).toBe(false)
    state = {
      preservable: true,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    }
    expect(isKioskSessionPreservable()).toBe(true)
  })

  it("surfaces the identified flag, holder name and badge token ids through getKioskSessionState", () => {
    cleanup = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
      badgeTokenIds: ["04aabbccddeeff"],
    }))
    expect(getKioskSessionState()).toEqual({
      preservable: true,
      identified: true,
      holderName: "Michael Schneider",
      badgeTokenIds: ["04aabbccddeeff"],
    })
  })

  it("unregistering restores the default", () => {
    const unregister = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: true,
      holderName: "Fritz Muster",
      badgeTokenIds: [],
    }))
    expect(isKioskSessionPreservable()).toBe(true)
    unregister()
    expect(getKioskSessionState()).toEqual({
      preservable: false,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    })
  })

  it("a stale unregister does not clear a newer guard", () => {
    const unregisterOld = registerKioskSessionGuard(() => ({
      preservable: false,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    }))
    cleanup = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: false,
      holderName: null,
      badgeTokenIds: [],
    }))
    unregisterOld()
    expect(isKioskSessionPreservable()).toBe(true)
  })
})
