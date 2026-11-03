// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Sequencing for the `bridge:reset-session` IPC handler (issue #516).
// Extracted from main.ts (same pattern as renderer/reset-button.ts) so the
// abort-then-wipe order is unit-testable without importing electron.

import type { ResetSessionOptions } from "./types"

export interface ResetSessionDeps {
  /** Wipe the volatile kiosk partition (storage + cache). */
  clearSession: () => Promise<void>
  /**
   * Stop a running terminal payment (absent when no terminal is
   * configured). Resolves once the abort is on its way.
   */
  abortTerminalPayment?: () => Promise<unknown>
}

/**
 * How long a reset waits for the terminal abort to go out. The abort is a
 * single frame on an open socket, so this only bites when the socket is
 * wedged — and a wedged terminal must not hold the session wipe hostage.
 */
export const TERMINAL_ABORT_CAP_MS = 1_500

/**
 * Ask the terminal to stop before the session goes away, so it doesn't keep
 * waiting for a card nobody will present. Best effort and capped: if the
 * card was already read the terminal ignores the abort anyway, and the
 * payment is settled server-side from Wallee's webhook regardless of the
 * kiosk.
 */
export async function abortTerminalBestEffort(
  abort: (() => Promise<unknown>) | undefined,
  capMs: number = TERMINAL_ABORT_CAP_MS
): Promise<void> {
  if (!abort) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve()
        .then(abort)
        .catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, capMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Stop any running terminal payment, then wipe the session. The window stays
 * where it is: the kiosk no longer autohides to the tray after a reset, so the
 * next user finds it in front. `opts` is still accepted because deployed web
 * app builds send `{ keepWindowOpen: true }` on a badge takeover; it is a
 * no-op now.
 */
export async function performSessionReset(
  deps: ResetSessionDeps,
  _opts?: ResetSessionOptions
): Promise<void> {
  await abortTerminalBestEffort(deps.abortTerminalPayment)
  await deps.clearSession()
}
