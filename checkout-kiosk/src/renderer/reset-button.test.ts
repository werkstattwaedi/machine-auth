// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression coverage for issue #415: the kiosk chrome "Neuer Checkout" button
// must NOT drop the in-progress checkout on a single tap. It now asks the web
// page for a confirm (page-owned single confirm UI) and only falls back to a
// direct storage-wiping reset if the page never acks (wedged webview).

import assert from "node:assert/strict"
import { test } from "node:test"
import { wireResetButton, type ResetButtonDeps } from "./reset-button"

interface Harness {
  click: () => void
  ack: () => void
  fireTimer: () => void
  requestStartOverCalls: number
  performResetCalls: number
  timerArmed: boolean
}

function makeHarness(over: Partial<ResetButtonDeps> = {}): Harness {
  let clickHandler: (() => void) | null = null
  let ackHandler: (() => void) | null = null
  let pendingTimer: (() => void) | null = null
  const state = {
    requestStartOverCalls: 0,
    performResetCalls: 0,
  }

  wireResetButton({
    onResetClick: (h) => {
      clickHandler = h
    },
    requestStartOver: () => {
      state.requestStartOverCalls += 1
    },
    onStartOverAck: (cb) => {
      ackHandler = cb
      return () => {
        ackHandler = null
      }
    },
    performReset: () => {
      state.performResetCalls += 1
    },
    setTimer: (cb) => {
      pendingTimer = cb
      return 1
    },
    clearTimer: () => {
      pendingTimer = null
    },
    timeoutMs: 1500,
    ...over,
  })

  return {
    click: () => clickHandler?.(),
    ack: () => ackHandler?.(),
    fireTimer: () => pendingTimer?.(),
    get requestStartOverCalls() {
      return state.requestStartOverCalls
    },
    get performResetCalls() {
      return state.performResetCalls
    },
    get timerArmed() {
      return pendingTimer !== null
    },
  }
}

test("clicking reset requests a page confirm and does NOT reset directly", () => {
  const h = makeHarness()
  h.click()
  assert.equal(h.requestStartOverCalls, 1)
  assert.equal(h.performResetCalls, 0, "must not drop the checkout on a tap")
  assert.equal(h.timerArmed, true, "fallback timer armed")
})

test("a page ack cancels the fallback (no direct reset)", () => {
  const h = makeHarness()
  h.click()
  h.ack()
  assert.equal(h.timerArmed, false, "ack clears the fallback timer")
  // Even if a stale timer somehow fires, the ack flag suppresses the reset.
  h.fireTimer()
  assert.equal(h.performResetCalls, 0)
})

test("fallback performs the direct reset when the page never acks", () => {
  const h = makeHarness()
  h.click()
  h.fireTimer()
  assert.equal(h.performResetCalls, 1, "wedged page -> escape hatch reset")
})
