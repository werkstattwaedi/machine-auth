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
  registerCheckinScreen,
  registerKioskSessionGuard,
  startPendingVisit,
} from "./kiosk-session-guard"

const NO_CHECKIN = {
  autoStartPending: false,
  onCheckinScreen: false,
  holderFirstName: null,
}

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
      committed: false,
      holderName: null,
      badgeTokenIds: [],
      paymentInProgress: false,
      ...NO_CHECKIN,
    })
    expect(isKioskSessionPreservable()).toBe(false)
  })

  it("reflects the registered getter live", () => {
    let state = {
      preservable: false,
      identified: false,
      committed: false,
      holderName: null,
      badgeTokenIds: [] as string[],
      paymentInProgress: false,
    }
    cleanup = registerKioskSessionGuard(() => state)
    expect(isKioskSessionPreservable()).toBe(false)
    state = {
      preservable: true,
      identified: false,
      committed: false,
      holderName: null,
      badgeTokenIds: [],
      paymentInProgress: false,
    }
    expect(isKioskSessionPreservable()).toBe(true)
  })

  it("surfaces the identified flag, holder name and badge token ids through getKioskSessionState", () => {
    cleanup = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: true,
      committed: false,
      holderName: "Michael Schneider",
      badgeTokenIds: ["04aabbccddeeff"],
      paymentInProgress: false,
    }))
    expect(getKioskSessionState()).toEqual({
      preservable: true,
      identified: true,
      committed: false,
      holderName: "Michael Schneider",
      badgeTokenIds: ["04aabbccddeeff"],
      paymentInProgress: false,
      ...NO_CHECKIN,
    })
  })

  it("unregistering restores the default", () => {
    const unregister = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: true,
      committed: false,
      holderName: "Fritz Muster",
      badgeTokenIds: [],
      paymentInProgress: false,
    }))
    expect(isKioskSessionPreservable()).toBe(true)
    unregister()
    expect(getKioskSessionState()).toEqual({
      preservable: false,
      identified: false,
      committed: false,
      holderName: null,
      badgeTokenIds: [],
      paymentInProgress: false,
      ...NO_CHECKIN,
    })
  })

  it("a stale unregister does not clear a newer guard", () => {
    const unregisterOld = registerKioskSessionGuard(() => ({
      preservable: false,
      identified: false,
      committed: false,
      holderName: null,
      badgeTokenIds: [],
      paymentInProgress: false,
    }))
    cleanup = registerKioskSessionGuard(() => ({
      preservable: true,
      identified: false,
      committed: false,
      holderName: null,
      badgeTokenIds: [],
      paymentInProgress: false,
    }))
    unregisterOld()
    expect(isKioskSessionPreservable()).toBe(true)
  })

  // Issue #732: /checkin contributes the countdown / unstarted-visit state.
  it("merges the registered check-in screen state and delegates startPendingVisit", async () => {
    const unregisterGuard = registerKioskSessionGuard(() => ({
      preservable: false,
      identified: true,
      committed: false,
      holderName: "Andrea Muster",
      badgeTokenIds: [],
      paymentInProgress: false,
    }))
    const start = async () => "Andrea"
    const unregisterScreen = registerCheckinScreen({
      getState: () => ({
        autoStartPending: true,
        onCheckinScreen: false,
        holderFirstName: "Andrea",
      }),
      startPendingVisit: start,
    })
    cleanup = () => {
      unregisterGuard()
      unregisterScreen()
    }
    expect(getKioskSessionState()).toMatchObject({
      identified: true,
      committed: false,
      autoStartPending: true,
      holderFirstName: "Andrea",
    })
    await expect(startPendingVisit()).resolves.toBe("Andrea")
    unregisterScreen()
    expect(getKioskSessionState()).toMatchObject(NO_CHECKIN)
    await expect(startPendingVisit()).rejects.toThrow()
  })
})
