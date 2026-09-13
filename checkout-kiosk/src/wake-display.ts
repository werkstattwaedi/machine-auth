// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Dismissing the Windows screensaver on a badge tap.
//
// `showWindow()` already restores and focuses the kiosk window on every tag
// read, but a running screensaver paints over everything: the tap "worked"
// (window raised, tag dispatched) while the user still faces the screensaver
// and has to jiggle the mouse to see the checkout they just started. Windows
// only tears a screensaver down on *input*, and Electron exposes no API for
// that — so synthesize the same small mouse move the user makes by hand.
//
// The identical input also wakes a monitor that has powered down, which is the
// other way the terminal ends up dark on approach, so one nudge covers both.
//
// Caveat worth knowing: if the terminal's screensaver is configured with "on
// resume, display logon screen" (ScreenSaverIsSecure=1), dismissing it lands
// on the Windows lock screen rather than the checkout. No app can — or
// should — click through that, so the terminal has to be configured
// non-secure for this to help.

/** MOUSEEVENTF_MOVE — a relative mouse move (winuser.h). */
const MOUSEEVENTF_MOVE = 0x0001

// One tap can produce more than one `onTag` call (bridge/nfc.ts dispatches
// either a full event or a uid-only fallback), and users re-tap when nothing
// appears to happen. Without a cooldown every one of those spawns its own
// PowerShell.
export const WAKE_COOLDOWN_MS = 2_000

// Nudge the cursor one pixel right, then straight back. A *relative* pair
// leaves the pointer exactly where it was, so this stays invisible mid-checkout
// while still counting as real input to the screensaver and the display-idle
// timer. A zero-delta move is not reliably treated as movement, hence
// there-and-back rather than a single no-op event.
const WAKE_SCRIPT = [
  `Add-Type -Namespace Oww -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);'`,
  `[Oww.Native]::mouse_event(${MOUSEEVENTF_MOVE}, 1, 0, 0, [IntPtr]::Zero)`,
  `[Oww.Native]::mouse_event(${MOUSEEVENTF_MOVE}, -1, 0, 0, [IntPtr]::Zero)`,
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
  /** Fire off the input nudge. Must not throw. */
  nudge: () => void
}

/**
 * Build the tap-time display waker. The returned function is safe to call on
 * every tag read: it no-ops off Windows, and collapses repeat taps inside
 * `WAKE_COOLDOWN_MS` into a single nudge.
 */
export function createDisplayWaker(
  deps: WakeDisplayDeps,
  cooldownMs: number = WAKE_COOLDOWN_MS
): () => void {
  let lastWakeAt: number | null = null
  return function wakeDisplay(): void {
    if (deps.platform !== "win32") return
    const now = deps.now()
    if (lastWakeAt !== null && now - lastWakeAt < cooldownMs) return
    lastWakeAt = now
    deps.nudge()
  }
}
