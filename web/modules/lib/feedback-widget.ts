// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Marker.io "Problem melden" helpers (issue #669). The widget loads for
// every visitor — the kiosk is where most reports come from — but its
// floating launcher overlapped the UI, so it only shows where the operations
// config sets web.markerLauncherVisible (staging). Elsewhere the capture is
// reached through the header menu (`AppMenu`, the same entry in the admin
// app, the checkout member area and the wizard — anonymous visitors
// included) and the Ctrl+Shift+PrintScreen shortcut.

/**
 * Whether Marker.io's floating launcher button should be visible, given the
 * VITE_MARKER_LAUNCHER_VISIBLE flag. Absent/empty (production, local, e2e)
 * keeps it hidden.
 */
export function shouldShowMarkerLauncher(flag: string | undefined): boolean {
  return flag === "true"
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
