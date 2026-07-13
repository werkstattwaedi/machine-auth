// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Sequencing for the `bridge:reset-session` IPC handler (issue #516).
// Extracted from main.ts (same pattern as renderer/reset-button.ts) so the
// hide-vs-keep-open decision is unit-testable without importing electron.

import type { ResetSessionOptions } from "./types"

export interface ResetSessionDeps {
  /** Wipe the volatile kiosk partition (storage + cache). */
  clearSession: () => Promise<void>
  /** Hide the kiosk window back to the tray. */
  hideWindow: () => void
}

/**
 * Clear the session, then autohide to the tray so the kiosk only reappears
 * when the next user taps a badge — the default for "Neuer Checkout" and the
 * renderer's fallback reset. A badge takeover (`confirmTagSwitch`) passes
 * `keepWindowOpen: true`: the next user is already standing at the kiosk, so
 * the window must stay in front while the wiped page reloads into /checkin
 * (issue #516 — it used to minimize to the tray mid-handoff).
 */
export async function performSessionReset(
  deps: ResetSessionDeps,
  opts?: ResetSessionOptions
): Promise<void> {
  await deps.clearSession()
  if (opts?.keepWindowOpen) return
  deps.hideWindow()
}
