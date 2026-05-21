// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"

/**
 * Whether the current device is a plausible target for the in-app QR
 * scanner. Used to gate the FAB on `/visit/$visitId` and the in-picker
 * scan-icon button.
 *
 * We deliberately don't reuse `useIsMobile()` (which is a flat
 * `window.innerWidth < 768` check): an unfolded Galaxy Z Fold or an
 * iPad held in landscape both register as "desktop" under that rule,
 * even though they have a rear camera and want the same touch-driven
 * scanning UX. Conversely, a touchscreen laptop with a mouse usually
 * still reports `pointer: fine`, which is correctly *excluded* here.
 *
 * Returns `false` until after first effect commit (so SSR / initial
 * paint never shows the entry points and then hides them).
 */
export function useCanScanQr(): boolean {
  const [canScan, setCanScan] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mql = window.matchMedia("(pointer: coarse) and (hover: none)")
    const hasCamera = !!navigator.mediaDevices?.getUserMedia
    const update = () => setCanScan(mql.matches && hasCamera)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [])
  return canScan
}
