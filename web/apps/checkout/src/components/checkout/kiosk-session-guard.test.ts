// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk session guard — module-level bridge between the wizard (state
 * owner) and BridgeNfcRouter (tap-time consumer):
 *   - defaults to "nothing to protect" when no wizard is mounted
 *   - reflects the registered getter live
 *   - unregister only clears its own registration (a newer guard wins)
 */

import { afterEach, describe, expect, it } from "vitest"
import {
  isKioskSessionPreservable,
  registerKioskSessionGuard,
} from "./kiosk-session-guard"

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe("kiosk-session-guard", () => {
  it("is false when no guard is registered", () => {
    expect(isKioskSessionPreservable()).toBe(false)
  })

  it("reflects the registered getter live", () => {
    let preservable = false
    cleanup = registerKioskSessionGuard(() => preservable)
    expect(isKioskSessionPreservable()).toBe(false)
    preservable = true
    expect(isKioskSessionPreservable()).toBe(true)
  })

  it("unregistering restores the default", () => {
    const unregister = registerKioskSessionGuard(() => true)
    expect(isKioskSessionPreservable()).toBe(true)
    unregister()
    expect(isKioskSessionPreservable()).toBe(false)
  })

  it("a stale unregister does not clear a newer guard", () => {
    const unregisterOld = registerKioskSessionGuard(() => false)
    cleanup = registerKioskSessionGuard(() => true)
    unregisterOld()
    expect(isKioskSessionPreservable()).toBe(true)
  })
})
