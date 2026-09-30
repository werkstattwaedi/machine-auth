// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression net for issue #688: a second kiosk launch must exit without
// starting anything (two instances race over each badge tap), and the running
// instance must come to the foreground instead.

import { test } from "node:test"
import assert from "node:assert/strict"

import { claimSingleInstance } from "./single-instance.ts"

function makeDeps(lockGranted: boolean) {
  const calls: string[] = []
  const listeners: Array<() => void> = []
  return {
    calls,
    listeners,
    deps: {
      requestLock: () => {
        calls.push("requestLock")
        return lockGranted
      },
      onSecondInstance: (listener: () => void) => {
        calls.push("onSecondInstance")
        listeners.push(listener)
      },
      quit: () => {
        calls.push("quit")
      },
      showWindow: () => {
        calls.push("showWindow")
      },
    },
  }
}

test("lock denied: quits and tells the caller not to start", () => {
  const { calls, listeners, deps } = makeDeps(false)
  assert.equal(claimSingleInstance(deps), false)
  // No listener and no window raise: the losing process has no window, and
  // must leave the running kiosk's session, tray and reader alone.
  assert.deepEqual(calls, ["requestLock", "quit"])
  assert.equal(listeners.length, 0)
})

test("lock granted: startup continues without quitting or raising", () => {
  const { calls, listeners, deps } = makeDeps(true)
  assert.equal(claimSingleInstance(deps), true)
  // The kiosk starts hidden in the tray; claiming the lock must not surface it.
  assert.deepEqual(calls, ["requestLock", "onSecondInstance"])
  assert.equal(listeners.length, 1)
})

test("a refused second launch brings the running kiosk to the foreground", () => {
  const { calls, listeners, deps } = makeDeps(true)
  claimSingleInstance(deps)
  calls.length = 0

  listeners[0]()
  assert.deepEqual(calls, ["showWindow"])

  // Every further launch raises it again — the listener is not one-shot.
  listeners[0]()
  assert.deepEqual(calls, ["showWindow", "showWindow"])
})
