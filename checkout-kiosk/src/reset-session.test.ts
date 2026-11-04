// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// A reset aborts the terminal, wipes the session, and leaves the window alone:
// the kiosk no longer autohides to the tray, whatever options the web app
// passes (issue #516 originally only kept it open on a badge takeover).

import { test } from "node:test"
import assert from "node:assert/strict"

import { abortTerminalBestEffort, performSessionReset } from "./reset-session.ts"

function makeDeps() {
  const calls: string[] = []
  return {
    calls,
    deps: {
      clearSession: async () => {
        calls.push("clearSession")
      },
    },
  }
}

test("default reset clears the session", async () => {
  const { calls, deps } = makeDeps()
  await performSessionReset(deps)
  assert.deepEqual(calls, ["clearSession"])
})

test("keepWindowOpen is accepted and changes nothing", async () => {
  for (const keepWindowOpen of [true, false]) {
    const { calls, deps } = makeDeps()
    await performSessionReset(deps, { keepWindowOpen })
    assert.deepEqual(calls, ["clearSession"])
  }
})

test("a running terminal payment is aborted before the session is wiped", async () => {
  const { calls, deps } = makeDeps()
  await performSessionReset({
    ...deps,
    abortTerminalPayment: async () => {
      calls.push("abortTerminalPayment")
    },
  })
  assert.deepEqual(calls, ["abortTerminalPayment", "clearSession"])
})

test("a failing terminal abort does not stop the reset", async () => {
  const { calls, deps } = makeDeps()
  await performSessionReset({
    ...deps,
    abortTerminalPayment: () => Promise.reject(new Error("socket gone")),
  })
  assert.deepEqual(calls, ["clearSession"])
})

test("a throwing terminal abort does not stop the reset", async () => {
  const { calls, deps } = makeDeps()
  await performSessionReset({
    ...deps,
    abortTerminalPayment: () => {
      throw new Error("sync bug")
    },
  })
  assert.deepEqual(calls, ["clearSession"])
})

test("a hanging terminal abort is given up after the cap", async () => {
  const started = Date.now()
  await abortTerminalBestEffort(() => new Promise(() => {}), 30)
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 25 && elapsed < 1_000, `took ${elapsed} ms`)
})
