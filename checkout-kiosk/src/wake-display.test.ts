// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The waker fires on a badge tap, so it runs on the hot path of every tag
// read: it must stay a no-op off Windows and must not spawn one PowerShell
// per read (bridge/nfc.ts can emit two `onTag` calls for a single tap, and
// users re-tap when the screen stays dark).

import { test } from "node:test"
import assert from "node:assert/strict"

import {
  createDisplayWaker,
  wakeCommandArgs,
  WAKE_COOLDOWN_MS,
} from "./wake-display.ts"

function makeWaker(platform: NodeJS.Platform = "win32") {
  let clock = 1_000
  let nudges = 0
  const wake = createDisplayWaker({
    platform,
    now: () => clock,
    nudge: () => {
      nudges++
    },
  })
  return {
    wake,
    advance: (ms: number) => {
      clock += ms
    },
    nudges: () => nudges,
  }
}

test("a tap on Windows nudges the display", () => {
  const w = makeWaker()
  w.wake()
  assert.equal(w.nudges(), 1)
})

test("repeat taps inside the cooldown collapse into one nudge", () => {
  const w = makeWaker()
  w.wake()
  w.advance(WAKE_COOLDOWN_MS - 1)
  w.wake()
  w.wake()
  assert.equal(w.nudges(), 1)
})

test("a tap after the cooldown nudges again", () => {
  const w = makeWaker()
  w.wake()
  w.advance(WAKE_COOLDOWN_MS)
  w.wake()
  assert.equal(w.nudges(), 2)
})

test("non-Windows platforms never nudge", () => {
  for (const platform of ["linux", "darwin"] as const) {
    const w = makeWaker(platform)
    w.wake()
    assert.equal(w.nudges(), 0, `${platform} should not nudge`)
  }
})

test("the encoded command round-trips to the original script", () => {
  const args = wakeCommandArgs("Write-Output 'it''s \"quoted\"'")
  const idx = args.indexOf("-EncodedCommand")
  assert.ok(idx >= 0, "must pass the script via -EncodedCommand")
  const decoded = Buffer.from(args[idx + 1]!, "base64").toString("utf16le")
  assert.equal(decoded, "Write-Output 'it''s \"quoted\"'")
})

test("the real script drives mouse_event there and back", () => {
  const args = wakeCommandArgs()
  const decoded = Buffer.from(
    args[args.indexOf("-EncodedCommand") + 1]!,
    "base64"
  ).toString("utf16le")
  assert.match(decoded, /user32\.dll/)
  // A relative +1 / -1 pair: real movement, zero net cursor displacement.
  assert.match(decoded, /mouse_event\(1, 1, 0, 0/)
  assert.match(decoded, /mouse_event\(1, -1, 0, 0/)
})
