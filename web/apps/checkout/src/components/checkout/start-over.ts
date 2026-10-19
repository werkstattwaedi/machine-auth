// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The shared "Von vorne beginnen" / kiosk "Neuer Checkout" reset primitive
// (issue #415), extracted from wizard-context so the kiosk-unification logic is
// unit-testable in isolation (the full WizardProvider has too many deps to
// render cheaply).
//
// Both reset affordances must give the *same strong wipe*: in the kiosk
// (`bridge.available`) we clear the volatile Electron partition — IndexedDB +
// the previous user's Firebase Auth — via `bridge.resetSession()` before the
// hard reload. In a browser tab there's no bridge, so `signOut` + reload is the
// in-process reset.

import { flushTerminalReport } from "./pending-terminal-report"

export interface StartOverDeps {
  signOut: () => Promise<void>
  bridgeAvailable: boolean
  resetSession: () => Promise<void>
  /** Hard navigation (window.location.replace) to the fresh /checkin target. */
  reload: (target: string) => void
  kiosk: boolean
  /**
   * First name of the visitor whose visit was just started (issue #732). The
   * bridge reset wipes storage, so the start-screen toast ("Besuch von …
   * gestartet") can only ride through the reload in the URL.
   */
  startedHint?: string | null
}

/** The fresh /checkin target of a reset, with the optional started hint. */
export function startOverTarget(
  kiosk: boolean,
  startedHint?: string | null,
): string {
  const parts: string[] = []
  if (kiosk) parts.push("kiosk")
  if (startedHint) parts.push(`started=${encodeURIComponent(startedHint)}`)
  return parts.length ? `/checkin?${parts.join("&")}` : "/checkin"
}

export async function runStartOver(deps: StartOverDeps): Promise<void> {
  // A Wallee terminal approval report still in flight must reach the server
  // as this session before it is wiped (#812).
  await flushTerminalReport()
  try {
    await deps.signOut()
  } catch (err) {
    // signOut is a local op and rarely rejects; if it does, fall through to
    // the wipe + reload rather than swallowing the rejection on a closed
    // dialog (the reload re-runs the wizard bootstrap).
    console.error("startOver: signOut failed", err)
  }
  if (deps.bridgeAvailable) {
    try {
      await deps.resetSession()
    } catch (err) {
      console.error("startOver: bridge.resetSession failed", err)
    }
  }
  deps.reload(startOverTarget(deps.kiosk, deps.startedHint))
}
