// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react"
import { ACTIVITY_EVENTS } from "./kiosk-idle-dialog"

/**
 * Screenshot hook: with `window.__OWW_FREEZE_AUTO_START__ = true` (set by a
 * Playwright init script) the countdown renders a fixed partial fill and never
 * fires, so a baseline of the running countdown is deterministic.
 */
function isFrozen(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { __OWW_FREEZE_AUTO_START__?: boolean })
      .__OWW_FREEZE_AUTO_START__ === true
  )
}

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'

export interface AutoStartCountdown {
  /** True while the countdown runs (not yet fired, cancelled or touched). */
  running: boolean
  /** Fill width in percent the button should transition to. */
  fillPercent: number
  /** Transition duration for the fill, in ms (0 = no transition). */
  fillDurationMs: number
}

/**
 * Kiosk "Besuch starten" countdown (issue #732): runs `durationMs` from mount
 * and then calls `onFire`, unless the person touches the screen first —
 * pointerdown, keydown or scroll anywhere (the idle watcher's activity
 * events), or a dialog opening over the page (badge purchase, switch
 * confirmation). Either ends it for good and calls `onCancel`; the button
 * then stays a plain primary.
 *
 * `durationMs` undefined = no countdown. Turning it undefined while running
 * stops the timer silently (the caller already knows why).
 *
 * The fill uses the same single CSS width transition as AutoActionButton:
 * JS only schedules the one completion timeout.
 */
export function useAutoStartCountdown({
  durationMs,
  onFire,
  onCancel,
}: {
  durationMs: number | undefined
  onFire: () => void
  onCancel?: () => void
}): AutoStartCountdown {
  const [ended, setEnded] = useState(false)
  const [armed, setArmed] = useState(false)
  const onFireRef = useRef(onFire)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onFireRef.current = onFire
    onCancelRef.current = onCancel
  })
  const frozen = isFrozen()
  const active = durationMs !== undefined && !ended

  useEffect(() => {
    if (durationMs === undefined || ended) return
    let done = false
    const finish = (fire: boolean) => {
      if (done) return
      done = true
      setEnded(true)
      if (fire) onFireRef.current()
      else onCancelRef.current?.()
    }

    // A dialog already up (or opening later) means the person is busy with
    // something else — never start a visit underneath it.
    if (document.querySelector(DIALOG_SELECTOR)) {
      finish(false)
      return
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(DIALOG_SELECTOR)) finish(false)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    const touched = () => finish(false)
    for (const evt of ACTIVITY_EVENTS) {
      // Capture: scroll inside an inner container doesn't bubble.
      window.addEventListener(evt, touched, { capture: true, passive: true })
    }

    // Double rAF: the 0% state must paint before the target flips to 100%,
    // or the transition is skipped (see AutoActionButton).
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true))
    })
    const timer = isFrozen() ? null : setTimeout(() => finish(true), durationMs)

    return () => {
      done = true
      observer.disconnect()
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, touched, { capture: true })
      }
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      if (timer) clearTimeout(timer)
    }
  }, [durationMs, ended])

  if (!active) return { running: false, fillPercent: 0, fillDurationMs: 0 }
  if (frozen) return { running: true, fillPercent: 40, fillDurationMs: 0 }
  return {
    running: true,
    fillPercent: armed ? 100 : 0,
    fillDurationMs: durationMs,
  }
}
