// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Regression net for issue #516: the badge-takeover reset must NOT autohide
// the kiosk to the tray (the next user is standing in front of it), while
// every other reset path keeps the hide-after-wipe default.

import { test } from "node:test"
import assert from "node:assert/strict"

import { performSessionReset } from "./reset-session.ts"

function makeDeps() {
  const calls: string[] = []
  return {
    calls,
    deps: {
      clearSession: async () => {
        calls.push("clearSession")
      },
      hideWindow: () => {
        calls.push("hideWindow")
      },
    },
  }
}

test("default reset clears the session, then hides to the tray", async () => {
  const { calls, deps } = makeDeps()
  await performSessionReset(deps)
  assert.deepEqual(calls, ["clearSession", "hideWindow"])
})

test("keepWindowOpen: false behaves like the default (clear, then hide)", async () => {
  const { calls, deps } = makeDeps()
  await performSessionReset(deps, { keepWindowOpen: false })
  assert.deepEqual(calls, ["clearSession", "hideWindow"])
})

test("keepWindowOpen: true clears the session and never hides", async () => {
  const { calls, deps } = makeDeps()
  await performSessionReset(deps, { keepWindowOpen: true })
  assert.deepEqual(calls, ["clearSession"])
})
