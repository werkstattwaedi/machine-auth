// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Cross-route handoff for the page scroll position when opening the
 * material picker (issue #394).
 *
 * The picker is a Radix Dialog (Sheet) mounted by the /visit/add/* routes.
 * Its scroll-lock (`react-remove-scroll`) applies `overflow: hidden` to
 * <body>, and because the wizard layout scrolls the body itself, that lock
 * collapses `window.scrollY` to 0 — the /visit page behind the sheet jumps
 * to the top, so the member can't see items being added.
 *
 * We can't capture the scroll inside the picker: React runs the dialog's
 * (descendant) scroll-lock effect *before* the picker's own effect, so by
 * the time the picker mounts the scroll is already zeroed. Instead we
 * capture the offset synchronously at the click site (still on /visit,
 * before navigating) and the picker restores from it. Deep-link entries
 * (QR codes) never call the capture, so they default to 0 — correct, since
 * there's no prior scroll to preserve.
 */

let anchoredScrollY = 0

/** Record the current page scroll before navigating into the picker. */
export function capturePickerScrollAnchor(): void {
  anchoredScrollY = window.scrollY
}

/** Read the captured offset (0 when none was set, e.g. QR deep-links). */
export function readPickerScrollAnchor(): number {
  return anchoredScrollY
}

/** Clear the captured offset once it's been consumed. */
export function clearPickerScrollAnchor(): void {
  anchoredScrollY = 0
}
