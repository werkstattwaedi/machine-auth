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

export interface StartOverDeps {
  signOut: () => Promise<void>
  bridgeAvailable: boolean
  resetSession: () => Promise<void>
  /** Hard navigation (window.location.replace) to the fresh /checkin target. */
  reload: (target: string) => void
  kiosk: boolean
}

export async function runStartOver(deps: StartOverDeps): Promise<void> {
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
  deps.reload(deps.kiosk ? "/checkin?kiosk" : "/checkin")
}
