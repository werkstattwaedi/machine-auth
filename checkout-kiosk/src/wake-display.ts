// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Dismissing the Windows screensaver on a badge tap.
//
// `showWindow()` already restores and focuses the kiosk window on every tag
// read, but a running screensaver paints over everything: the tap "worked"
// (window raised, tag dispatched) while the user still faces the screensaver
// and has to jiggle the mouse to see the checkout they just started.
//
// The obvious fix — synthesize the mouse move the user makes by hand — does
// NOT work, and it fails silently. A running screensaver lives on its own
// desktop (`winsta0\Screen-saver`), while `mouse_event` / `keybd_event` inject
// into the *calling* thread's desktop. The input therefore never reaches the
// screensaver: measured on Windows 11, neither a synthetic mouse move nor a
// synthetic keypress dismissed a running screensaver, even though both reset
// the system idle timer. Resetting that timer is not the same thing as
// dismissing the screensaver — the screensaver's own window procedure decides
// that, and it never sees desktop-crossing input.
//
// What does work is terminating the screensaver process, which is not
// desktop-bound. Screensavers are `.scr` executables, and Windows only strips
// `.exe` when deriving a process name, so they show up as e.g. `ssText3d.scr`
// — a precise filter that needs no path lookup (and so no access-denied
// handling for processes we cannot open).
//
// The mouse nudge is kept, for a different reason than it was added: killing
// the screensaver does not reset the idle timer, so without it Windows would
// be free to re-arm the screensaver seconds later — the idle clock is still
// sitting past the timeout at that point. The nudge also wakes a monitor that
// has powered down, the other way the terminal ends up dark on approach.
//
// Dismissing the screensaver is only half the job. While it is up, the
// foreground window belongs to no reachable process (GetForegroundWindow
// resolves to the Idle process), and when it exits Windows hands the
// foreground back to whatever held it *before* it engaged. A `showWindow()`
// issued while the screensaver is still up is therefore thrown away, and the
// kiosk ends up behind the previously-focused window. So the script reports
// via its exit code whether it actually dismissed a screensaver, letting the
// caller re-assert the foreground once the desktop has settled.
//
// Caveat worth knowing: if the terminal's screensaver is configured with "on
// resume, display logon screen" (ScreenSaverIsSecure=1), dismissing it lands
// on the Windows lock screen rather than the checkout. No app can — or
// should — click through that, so the terminal has to be configured
// non-secure for this to help.

/** MOUSEEVENTF_MOVE — a relative mouse move (winuser.h). */
const MOUSEEVENTF_MOVE = 0x0001

/** SPI_GETSCREENSAVERRUNNING — is the *system* screensaver up right now? */
const SPI_GETSCREENSAVERRUNNING = 0x0072

/**
 * Exit code the script uses to say "a screensaver was up and I killed it", as
 * opposed to the ordinary "nothing to do" 0. Distinct from PowerShell's own
 * failure codes so a broken script never reads as a dismissal.
 */
export const SCREENSAVER_DISMISSED_EXIT = 10

// One tap can produce more than one `onTag` call (bridge/nfc.ts dispatches
// either a full event or a uid-only fallback), and users re-tap when nothing
// appears to happen. Without a cooldown every one of those spawns its own
// PowerShell.
export const WAKE_COOLDOWN_MS = 2_000

// Nudge the cursor one pixel right, then straight back: a *relative* pair
// leaves the pointer exactly where it was, so it stays invisible if it fires
// mid-checkout, while still counting as input for the idle timer.
//
// The kill is gated on SPI_GETSCREENSAVERRUNNING rather than run
// unconditionally, so a badge tap during normal operation never terminates a
// stray `.scr` process. Note the flag reports only the *system*-initiated
// screensaver — one launched by hand with `/s` reads as not running.
const WAKE_SCRIPT = [
  `Add-Type -Namespace Oww -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo); [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref bool pvParam, uint fWinIni);'`,
  `[Oww.Native]::mouse_event(${MOUSEEVENTF_MOVE}, 1, 0, 0, [IntPtr]::Zero)`,
  `[Oww.Native]::mouse_event(${MOUSEEVENTF_MOVE}, -1, 0, 0, [IntPtr]::Zero)`,
  `$running = $false`,
  `[void][Oww.Native]::SystemParametersInfo(${SPI_GETSCREENSAVERRUNNING}, 0, [ref]$running, 0)`,
  `if ($running) { Get-Process -Name '*.scr' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; exit ${SCREENSAVER_DISMISSED_EXIT} }`,
].join("; ")

/**
 * PowerShell's `-EncodedCommand` takes base64-encoded UTF-16LE. The script
 * embeds both double and single quotes; passing it through argv as plain text
 * would mean trusting Node's Windows argument escaping and PowerShell's own
 * parser to agree about them. Encoding sidesteps that class of quoting bug
 * entirely. `-EncodedCommand` is also unaffected by ExecutionPolicy, which
 * only governs script *files*.
 */
export function wakeCommandArgs(script = WAKE_SCRIPT): readonly string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]
}

export interface WakeDisplayDeps {
  /** `process.platform`; the nudge is Win32-only and a no-op elsewhere. */
  platform: NodeJS.Platform
  /** Clock backing the cooldown. */
  now: () => number
  /**
   * Fire off the wake attempt. Must not throw. Calls `onDismissed` only when a
   * screensaver was actually up and has now been torn down — that is the case
   * where the caller has to re-assert the foreground.
   */
  nudge: (onDismissed: () => void) => void
}

/**
 * Build the tap-time display waker. The returned function is safe to call on
 * every tag read: it no-ops off Windows, and collapses repeat taps inside
 * `WAKE_COOLDOWN_MS` into a single attempt.
 */
export function createDisplayWaker(
  deps: WakeDisplayDeps,
  cooldownMs: number = WAKE_COOLDOWN_MS
): (onDismissed: () => void) => void {
  let lastWakeAt: number | null = null
  return function wakeDisplay(onDismissed: () => void): void {
    if (deps.platform !== "win32") return
    const now = deps.now()
    if (lastWakeAt !== null && now - lastWakeAt < cooldownMs) return
    lastWakeAt = now
    deps.nudge(onDismissed)
  }
}
