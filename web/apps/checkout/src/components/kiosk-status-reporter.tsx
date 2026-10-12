// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { resolveBridgeBearer, useBridge } from "@modules/lib/use-bridge"

const STORAGE_KEY = "oww.kioskStatusReported"
const REPORT_EVERY_MS = 24 * 60 * 60 * 1000

interface Reported {
  version: string
  at: number
}

/** Report when the kiosk runs a version it hasn't reported, or daily. */
export function kioskStatusDue(
  reported: Reported | null,
  version: string,
  now: number,
): boolean {
  return (
    reported === null ||
    reported.version !== version ||
    now - reported.at >= REPORT_EVERY_MS
  )
}

function readReported(): Reported | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    return parsed && typeof parsed.version === "string" && typeof parsed.at === "number"
      ? parsed
      : null
  } catch {
    return null
  }
}

function writeReported(value: Reported): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage blocked: the server still writes at most hourly.
  }
}

/**
 * Tells the cloud which kiosk build the checkout app runs in (ADR-0045,
 * phase 2c) — the admin "Versionen" page reads it. Inert outside the kiosk
 * and on kiosk builds that don't expose a version. Fire-and-forget: a
 * failed report is retried on the next load and never reaches the UI.
 */
export function KioskStatusReporter() {
  const functions = useFunctions()
  const { available, version } = useBridge()

  useEffect(() => {
    if (!available || !version) return
    const now = Date.now()
    if (!kioskStatusDue(readReported(), version, now)) return
    void (async () => {
      try {
        const bearer = await resolveBridgeBearer()
        await rpcCallable(functions, "authCall", "reportKioskStatus")({
          bearer: bearer ?? undefined,
          version,
        })
        writeReported({ version, at: now })
      } catch {
        // Next load retries.
      }
    })()
  }, [available, version, functions])

  return null
}
