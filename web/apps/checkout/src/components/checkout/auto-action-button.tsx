// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { AlertDialogAction } from "@modules/components/ui/alert-dialog"

interface AutoActionButtonProps {
  /** Time from mount until the action auto-fires. */
  durationMs: number
  /** Fired exactly once — by the timer or an explicit click, whichever
   * comes first. */
  onAction: () => void
  children: ReactNode
}

/**
 * AlertDialog action button whose background fills while an auto-accept
 * timer drains — the MaCo terminal's "Beenden?" pattern. Shared by every
 * kiosk auto-dismiss flow (completion dialog, "Besuch gestartet", idle
 * watcher) so they all look and behave identically.
 *
 * The fill is a single CSS width transition over the full duration. The
 * previous per-tick JS repaint rounded the width to whole percent, which
 * stepped visibly (a 1% step every ~300ms on a 30s timer); the compositor
 * interpolates a lone transition smoothly. JS only schedules the one
 * completion timeout.
 */
export function AutoActionButton({
  durationMs,
  onAction,
  children,
}: AutoActionButtonProps) {
  // false until the first paint committed width 0 — flipping to true then
  // starts the one full-duration transition to 100%.
  const [armed, setArmed] = useState(false)
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction
  const firedRef = useRef(false)
  const fire = () => {
    if (firedRef.current) return
    firedRef.current = true
    onActionRef.current()
  }

  useEffect(() => {
    // Double rAF: the browser must paint the 0% state before the target
    // flips to 100%, otherwise the transition is skipped entirely and the
    // bar jumps straight to full.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true))
    })
    const timer = setTimeout(fire, durationMs)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs])

  return (
    <AlertDialogAction onClick={fire} className="relative overflow-hidden">
      <span
        aria-hidden
        data-testid="auto-action-progress"
        className="absolute inset-y-0 left-0 bg-cog-teal-dark"
        style={{
          width: armed ? "100%" : "0%",
          transitionProperty: "width",
          transitionTimingFunction: "linear",
          transitionDuration: `${durationMs}ms`,
        }}
      />
      <span className="relative z-10">{children}</span>
    </AlertDialogAction>
  )
}
