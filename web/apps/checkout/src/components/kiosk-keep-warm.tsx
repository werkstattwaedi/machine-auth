// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import { useFunctions } from "@modules/lib/firebase-context"
import { prewarm } from "@modules/lib/rpc"
import { useBridge } from "@modules/lib/use-bridge"

// Cloud Run idles an instance out after ~15 min; pinging well inside that
// keeps one warm. Around the clock is ~4.3k no-op calls a month — inside
// the free tier, and it stops by itself when the kiosk is off.
export const KIOSK_KEEP_WARM_INTERVAL_MS = 10 * 60_000

/**
 * Keeps `authCall` warm while the kiosk idles (ADR-0037 addendum). A badge
 * tap goes straight to `authCall` (`verifyTagCheckout` /
 * `exchangeKioskSession`), but the per-mount prewarms only fire once a
 * session has started, so the first tap after an idle stretch paid a cold
 * start. Inert outside the kiosk.
 */
export function KioskKeepWarm() {
  const functions = useFunctions()
  const { available } = useBridge()

  useEffect(() => {
    if (!available) return
    prewarm(functions, "authCall")
    const id = setInterval(
      () => prewarm(functions, "authCall"),
      KIOSK_KEEP_WARM_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [available, functions])

  return null
}
