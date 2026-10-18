// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The Wallee terminal approval report in flight (#812), page-wide.
 *
 * The report must reach the server as the session that prepared the
 * attempt: once a reset wipes it, a retry runs as someone else and is
 * refused. Every reset goes through `runStartOver`, which can't reach the
 * wizard's hook state (the idle watcher and the account sign-out live
 * outside the wizard), so the one pending report lives here. One kiosk page
 * has at most one terminal payment at a time.
 */

/** How long a reset waits for the report before wiping the session anyway. */
export const APPROVAL_REPORT_FLUSH_MS = 3_000

let pending: Promise<void> | null = null

/** Registers the report in flight; it unregisters itself when done. */
export function trackTerminalReport(report: Promise<void>): void {
  const tracked = report.finally(() => {
    if (pending === tracked) pending = null
  })
  pending = tracked
}

/** Waits for the report in flight, at most `APPROVAL_REPORT_FLUSH_MS`. */
export async function flushTerminalReport(): Promise<void> {
  const current = pending
  if (!current) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    current,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, APPROVAL_REPORT_FLUSH_MS)
    }),
  ])
  clearTimeout(timer)
}
