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

function decodedScript(): string {
  const args = wakeCommandArgs()
  return Buffer.from(
    args[args.indexOf("-EncodedCommand") + 1]!,
    "base64"
  ).toString("utf16le")
}

test("the script never terminates the screensaver process", () => {
  // A killed .scr skips its own exit path, leaving SPI_SETSCREENSAVERRUNNING
  // stale — on the terminal that broke the next screensaver launch and our
  // own running-gate. It has to be asked to close instead.
  const script = decodedScript()
  assert.doesNotMatch(script, /Stop-Process|TerminateProcess|\.scr/)
})

test("the script asks the screensaver to close via WM_CLOSE", () => {
  const script = decodedScript()
  // Screen-saver desktop first, with read+write access (0x0001 | 0x0080).
  assert.match(script, /OpenDesktop\("Screen-saver", 0, false, 129\)/)
  assert.match(script, /EnumDesktopWindows\(desk,/)
  assert.match(script, /CloseDesktop\(desk\)/)
  // Default-desktop fallback.
  assert.match(script, /FindWindow\("WindowsScreenSaverClass", null\)/)
  // WM_CLOSE = 0x0010 = 16, on both paths.
  assert.equal(script.match(/PostMessage\([^,]+, 16,/g)?.length, 2)
})

test("an ordinary tap exits 0 before touching any window", () => {
  // SPI_GETSCREENSAVERRUNNING = 0x0072 = 114. The gate must come before the
  // first OpenDesktop, or a tap with no screensaver would still post WM_CLOSE.
  const script = decodedScript()
  const gate = script.indexOf("if (!running) return 0;")
  assert.ok(script.includes("SystemParametersInfo(114, 0, ref running, 0)"))
  assert.ok(gate >= 0, "expected the running gate")
  assert.ok(gate < script.indexOf("OpenDesktop(\"Screen-saver\""))
})

test("the script reports an acted-on screensaver through its exit code", () => {
  const script = decodedScript()
  assert.notEqual(SCREENSAVER_DISMISSED_EXIT, 0)
  // Both dismissal paths return it; PowerShell turns it into the exit code.
  const returns = script.match(
    new RegExp(`return ${SCREENSAVER_DISMISSED_EXIT};`, "g")
  )
  assert.equal(returns?.length, 2)
  assert.match(script, /exit \[Oww\.Saver\]::Dismiss\(\)/)
})

test("the here-string terminator starts its own line", () => {
  // PowerShell only ends @'...'@ on a line starting with '@; anything else
  // swallows the rest of the script into the C# source and fails to compile.
  assert.match(decodedScript(), /\n'@\n/)
})

test("the nudge stays, as a relative there-and-back move", () => {
  // Resets the idle timer so Windows does not immediately re-arm the
  // screensaver; +1/-1 means no net cursor movement.
  const script = decodedScript()
  assert.match(script, /mouse_event\(1, 1, 0, 0/)
  assert.match(script, /mouse_event\(1, -1, 0, 0/)
})
