// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Dismissing the Windows screensaver on a badge tap.
//
// `showWindow()` already restores and focuses the kiosk window on every tag
// read, but a running screensaver paints over everything: the tap "worked"
// (window raised, tag dispatched) while the user still faces the screensaver
// and has to jiggle the mouse to see the checkout they just started.
//
// Synthetic input does NOT dismiss it, and fails silently. A running
// screensaver lives on its own desktop (`winsta0\Screen-saver`), while
// `mouse_event` / `keybd_event` / `SendInput` inject into the *calling*
// thread's desktop, so the screensaver never sees the input — even though the
// same input does reset the system idle timer.
//
// Killing the `.scr` process (what 1.0.6–1.0.11 did) dismisses it once but is
// not safe: a terminated screensaver never runs its normal exit path, which is
// where it clears SPI_SETSCREENSAVERRUNNING and lets winlogon switch back from
// the Screen-saver desktop. On the terminal that left the "running" flag
// stale, which broke the next screensaver launch and our own
// SPI_GETSCREENSAVERRUNNING gate.
//
// Windows has no documented "dismiss screensaver" API. The sanctioned
// technique (Microsoft KB 140723) is to ask the screensaver to close itself:
// post WM_CLOSE to its windows, so it exits through its own path and cleans up
// after itself. It lives on the Screen-saver desktop when Windows launched it
// there; otherwise it is an ordinary `WindowsScreenSaverClass` window on the
// default desktop.
//
// Posting WM_CLOSE is asynchronous: exit code 10 means "a screensaver was up
// and we asked it to close", not "it is gone". That is fine for the caller,
// which re-asserts the window on a schedule anyway (see below).
//
// The mouse nudge stays, to reset the idle timer: without it the idle clock is
// still past the timeout when the screensaver exits, so Windows is free to
// re-arm it seconds later. It also wakes a monitor that has powered down.
//
// Dismissing the screensaver is only half the job. While it is up, the
// foreground window belongs to no reachable process (GetForegroundWindow
// resolves to the Idle process), and when it exits Windows hands the
// foreground back to whatever held it *before* it engaged. A `showWindow()`
// issued while the screensaver is still up is therefore thrown away. So the
// script reports via its exit code whether it acted on a screensaver, letting
// the caller re-assert the window once the desktop has settled.
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

/** DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS — enough to enumerate and post. */
const DESKTOP_READ_WRITE = 0x0001 | 0x0080

/** WM_CLOSE — ask a window to close itself. */
const WM_CLOSE = 0x0010

/**
 * Exit code the script uses to say "a screensaver was up and we asked it to
 * close", as opposed to the ordinary "nothing to do" 0. Distinct from
 * PowerShell's own failure codes so a broken script never reads as a
 * dismissal.
 */
export const SCREENSAVER_DISMISSED_EXIT = 10

// One tap can produce more than one `onTag` call (bridge/nfc.ts dispatches
// either a full event or a uid-only fallback), and users re-tap when nothing
// appears to happen. Without a cooldown every one of those spawns its own
// PowerShell.
export const WAKE_COOLDOWN_MS = 2_000

// The logic lives in compiled C# rather than PowerShell because
// EnumDesktopWindows needs a callback, which PowerShell cannot hand to
// P/Invoke cleanly. The nudge is a relative +1/-1 pair, so the cursor ends up
// exactly where it was. The SPI_GETSCREENSAVERRUNNING gate means an ordinary
// tap never posts WM_CLOSE anywhere; note it reports only the
// *system*-initiated screensaver — one launched by hand with `/s` reads as not
// running, so it cannot be used to fake the scenario in a test.
const SAVER_CSHARP = `
using System;
using System.Runtime.InteropServices;
namespace Oww {
  public static class Saver {
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref bool pvParam, uint fWinIni);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    public static int Dismiss() {
      mouse_event(${MOUSEEVENTF_MOVE}, 1, 0, 0, IntPtr.Zero);
      mouse_event(${MOUSEEVENTF_MOVE}, -1, 0, 0, IntPtr.Zero);

      bool running = false;
      SystemParametersInfo(${SPI_GETSCREENSAVERRUNNING}, 0, ref running, 0);
      if (!running) return 0;

      IntPtr desk = OpenDesktop("Screen-saver", 0, false, ${DESKTOP_READ_WRITE});
      if (desk != IntPtr.Zero) {
        try {
          EnumDesktopWindows(desk, (hWnd, lParam) => {
            PostMessage(hWnd, ${WM_CLOSE}, IntPtr.Zero, IntPtr.Zero);
            return true;
          }, IntPtr.Zero);
        } finally {
          CloseDesktop(desk);
        }
        return ${SCREENSAVER_DISMISSED_EXIT};
      }

      IntPtr saver = FindWindow("WindowsScreenSaverClass", null);
      if (saver == IntPtr.Zero) return 0;
      PostMessage(saver, ${WM_CLOSE}, IntPtr.Zero, IntPtr.Zero);
      return ${SCREENSAVER_DISMISSED_EXIT};
    }
  }
}
`

// A here-string's closing '@ must start its own line, hence "\n" joins.
const WAKE_SCRIPT = [
  "Add-Type -TypeDefinition @'",
  SAVER_CSHARP,
  "'@",
  "exit [Oww.Saver]::Dismiss()",
].join("\n")

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
