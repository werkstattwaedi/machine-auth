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
  SCREENSAVER_DISMISSED_EXIT,
  wakeCommandArgs,
  WAKE_COOLDOWN_MS,
} from "./wake-display.ts"

function makeWaker(
  platform: NodeJS.Platform = "win32",
  { dismisses = false } = {}
) {
  let clock = 1_000
  let nudges = 0
  const wake = createDisplayWaker({
    platform,
    now: () => clock,
    nudge: (onDismissed) => {
      nudges++
      // Stand in for the PowerShell child exiting with the dismissal code.
      if (dismisses) onDismissed()
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

/** Most tests don't care about the dismissal callback. */
const ignore = () => {}

test("a tap on Windows nudges the display", () => {
  const w = makeWaker()
  w.wake(ignore)
  assert.equal(w.nudges(), 1)
})

test("repeat taps inside the cooldown collapse into one nudge", () => {
  const w = makeWaker()
  w.wake(ignore)
  w.advance(WAKE_COOLDOWN_MS - 1)
  w.wake(ignore)
  w.wake(ignore)
  assert.equal(w.nudges(), 1)
})

test("a tap after the cooldown nudges again", () => {
  const w = makeWaker()
  w.wake(ignore)
  w.advance(WAKE_COOLDOWN_MS)
  w.wake(ignore)
  assert.equal(w.nudges(), 2)
})

test("non-Windows platforms never nudge", () => {
  for (const platform of ["linux", "darwin"] as const) {
    const w = makeWaker(platform)
    w.wake(ignore)
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

test("a dismissal is reported back so the caller can re-take the foreground", () => {
  // Windows hands the foreground back to whatever held it before the
  // screensaver engaged, so the kiosk has to re-assert itself afterwards —
  // it only learns to do that through this callback.
  let dismissed = 0
  const w = makeWaker("win32", { dismisses: true })
  w.wake(() => {
    dismissed++
  })
  assert.equal(dismissed, 1)
})

test("an ordinary tap with no screensaver reports no dismissal", () => {
  let dismissed = 0
  const w = makeWaker("win32", { dismisses: false })
  w.wake(() => {
    dismissed++
  })
  assert.equal(w.nudges(), 1)
  assert.equal(dismissed, 0)
})

test("the script signals a dismissal through its exit code", () => {
  const args = wakeCommandArgs()
  const decoded = Buffer.from(
    args[args.indexOf("-EncodedCommand") + 1]!,
    "base64"
  ).toString("utf16le")
  // The exit must sit inside the $running branch: a tap with no screensaver
  // has to fall through to 0, or every tap would re-assert the foreground.
  const branchStart = decoded.indexOf("if ($running) {")
  assert.ok(branchStart >= 0, "expected a $running guard")
  const branch = decoded.slice(branchStart)
  assert.ok(
    branch.includes(`exit ${SCREENSAVER_DISMISSED_EXIT}`),
    "dismissal exit code must be inside the guard"
  )
  assert.notEqual(SCREENSAVER_DISMISSED_EXIT, 0)
})

test("the script kills the screensaver, gated on it actually running", () => {
  const args = wakeCommandArgs()
  const decoded = Buffer.from(
    args[args.indexOf("-EncodedCommand") + 1]!,
    "base64"
  ).toString("utf16le")

  // Injected input cannot cross into the screensaver's own desktop, so
  // terminating the process is what actually dismisses it. `.scr` survives in
  // the process name because Windows only strips `.exe`.
  assert.match(decoded, /Get-Process -Name '\*\.scr'/)
  assert.match(decoded, /Stop-Process -Force/)

  // Never terminate a stray .scr on an ordinary tap: the kill is guarded by
  // SPI_GETSCREENSAVERRUNNING (0x0072 = 114).
  assert.match(decoded, /SystemParametersInfo\(114, 0, \[ref\]\$running, 0\)/)
  assert.match(decoded, /if \(\$running\) \{ Get-Process/)

  // The nudge stays, to reset the idle timer so Windows cannot immediately
  // re-arm the screensaver we just killed. Relative +1/-1 = no net movement.
  assert.match(decoded, /mouse_event\(1, 1, 0, 0/)
  assert.match(decoded, /mouse_event\(1, -1, 0, 0/)
})
