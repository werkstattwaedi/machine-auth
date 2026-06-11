// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Cross-route handoff for the page scroll position across the material
 * picker's open→close lifecycle (issues #394 and #451).
 *
 * The picker is a Radix Dialog (Sheet) mounted by the /visit/add/* routes.
 * Its scroll-lock (`react-remove-scroll`) applies `overflow: hidden` to
 * <body>, and because the wizard layout scrolls the body itself, toggling
 * that lock collapses `window.scrollY` to 0 — the /visit page behind the
 * sheet jumps to the top on open, and would lose its scroll again when the
 * sheet is dismissed (#451), so the member can't see items being added.
 *
 * We can't capture the scroll inside the picker: React runs the dialog's
 * (descendant) scroll-lock effect *before* the picker's own effect, so by
 * the time the picker mounts the scroll is already zeroed. Instead we
 * capture the offset synchronously at the click site (still on /visit,
 * before navigating) and restore from it on **both** the open and the
 * close reflow. The anchor therefore lives for the whole open→close span:
 * the picker re-asserts it while open, the host's close handler re-asserts
 * it through dismissal, and only the close path clears it. Deep-link
 * entries (QR codes) never call the capture, so they default to 0 —
 * correct, since there's no prior scroll to preserve.
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

// Open: the scroll-lock reflow zeroes scroll within a frame or two, so a
// short window suffices. Close: react-remove-scroll restores <body> overflow
// *and* the router scrolls the navigated-to /visit page to the top — the
// latter lands ~1 s after dismissal, so the close window must outlast it.
const OPEN_REASSERT_MS = 600
const CLOSE_REASSERT_MS = 1500

/**
 * Re-assert `target` against `window.scrollY` every animation frame for
 * `durationMs`, so the restore outlasts whatever reflow keeps yanking the
 * page to the top. It re-asserts *continuously* (not just once) because the
 * collapse can land in several waves (the overflow-restore on the first
 * frame, the router's scroll-to-top ~1 s later). Returns a canceller.
 */
export function reassertPageScroll(
  target: number,
  durationMs: number = OPEN_REASSERT_MS,
): () => void {
  let rafId = 0
  const start = performance.now()
  const tick = () => {
    if (window.scrollY !== target) window.scrollTo(0, target)
    if (performance.now() - start < durationMs) {
      rafId = requestAnimationFrame(tick)
    }
  }
  rafId = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(rafId)
}

/**
 * Restore the anchored scroll offset when the picker is dismissed (#451),
 * then clear the anchor. Call this from the host's `onOpenChange(false)`
 * handler — the precise, single-fire close signal — *before* navigating
 * back to /visit. The re-assert loop is intentionally fire-and-forget: it
 * must outlive the picker route's unmount and self-terminates after the
 * close window. No-op when there's no anchor (e.g. QR deep-link entries).
 *
 * The loop bails the moment the URL leaves the /visit subtree, so a member
 * who closes the picker and immediately moves on (e.g. straight to the
 * checkout summary) doesn't have their new page yanked to the stale offset.
 */
export function restorePickerScrollAnchor(): void {
  const target = anchoredScrollY
  anchoredScrollY = 0
  if (target === 0) return
  // The picker always closes back onto /visit; once we navigate elsewhere
  // the anchored offset is meaningless, so stop re-asserting it.
  const restorePath = "/visit"
  const start = performance.now()
  const tick = () => {
    if (!window.location.pathname.startsWith(restorePath)) return
    if (window.scrollY !== target) window.scrollTo(0, target)
    if (performance.now() - start < CLOSE_REASSERT_MS) {
      requestAnimationFrame(tick)
    }
  }
  requestAnimationFrame(tick)
}
