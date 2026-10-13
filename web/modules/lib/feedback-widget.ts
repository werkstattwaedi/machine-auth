// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Marker.io "Problem melden" helpers (issue #669). The widget loads for
// every visitor — the kiosk is where most reports come from — but its
// floating launcher overlapped the UI, so it only shows on staging. Elsewhere
// the capture is reached through the account menu, the admin sidebar and the
// Ctrl+Shift+PrintScreen shortcut.

/** Firebase project of the staging deployment. */
export const STAGING_FIREBASE_PROJECT_ID = "oww-maco-staging"

/**
 * Whether Marker.io's floating launcher button should be visible. Only built
 * staging bundles show it; production and the dev server (incl. e2e, whose
 * env carries the production project id) keep it hidden.
 */
export function shouldShowMarkerLauncher(env: {
  projectId: string | undefined
  dev: boolean
}): boolean {
  return !env.dev && env.projectId === STAGING_FIREBASE_PROJECT_ID
}

/** Ctrl+Shift+PrintScreen opens the capture. */
export function isFeedbackShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === "PrintScreen" || event.code === "PrintScreen")
  )
}

/** True once the Marker.io stub is installed (the capture can be opened). */
export function isFeedbackAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.__Marker)
}

/**
 * Opens the Marker.io capture. Before the shim has loaded this lands in the
 * stub's queue and replays on load; without the widget it is a no-op.
 */
export function openFeedback(): void {
  const capture = window.Marker?.capture
  if (typeof capture === "function") capture("fullscreen")
}
