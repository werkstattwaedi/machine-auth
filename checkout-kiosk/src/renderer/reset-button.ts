// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Pure wiring for the kiosk chrome "Neuer Checkout" button (issue #415).
//
// Extracted from renderer.ts so the reset flow can be unit-tested without a
// DOM or the Electron bridge. The button no longer resets directly; instead it
// asks the loaded web page to show the shared confirm dialog (single confirm
// UI, no duplicate chrome overlay). The page acks once it has the request,
// which cancels the hardware-escape-hatch fallback. If the page never acks
// (wedged/unresponsive webview), the fallback performs the direct
// storage-wiping reset so staff always have an escape hatch.

export interface ResetButtonDeps {
  /** Subscribe to the reset button's click. Returns nothing; wired once. */
  onResetClick: (handler: () => void) => void
  /** Ask the web page to show its confirm dialog. */
  requestStartOver: () => void
  /** Subscribe to the page's ack that it received the request. */
  onStartOverAck: (cb: () => void) => () => void
  /** Direct storage-wiping reset + reload (the fallback / escape hatch). */
  performReset: () => void | Promise<void>
  /** Inject the timer fns so tests can drive them deterministically. */
  setTimer?: (cb: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** How long to wait for the page ack before falling back. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 1500

/**
 * Wire the chrome reset button to the page-driven confirm flow with a
 * timeout fallback. Returns a disposer that removes the ack subscription and
 * clears any pending timer (handy for tests / teardown).
 */
export function wireResetButton(deps: ResetButtonDeps): () => void {
  const setTimer =
    deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms) as unknown)
  const clearTimer =
    deps.clearTimer ?? ((handle) => clearTimeout(handle as never))
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let fallbackTimer: unknown = null
  let acked = false

  const clearFallback = () => {
    if (fallbackTimer !== null) {
      clearTimer(fallbackTimer)
      fallbackTimer = null
    }
  }

  // The page acks: cancel the pending fallback — the web confirm dialog now
  // owns the flow.
  const unsubscribeAck = deps.onStartOverAck(() => {
    acked = true
    clearFallback()
  })

  deps.onResetClick(() => {
    acked = false
    clearFallback()
    deps.requestStartOver()
    fallbackTimer = setTimer(() => {
      fallbackTimer = null
      if (!acked) {
        void deps.performReset()
      }
    }, timeoutMs)
  })

  return () => {
    clearFallback()
    unsubscribeAck()
  }
}
