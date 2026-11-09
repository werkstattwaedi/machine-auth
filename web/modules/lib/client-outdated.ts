// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The server said this app is older than `config/clients.minVersion` (#845).
 * A tiny store outside React so `rpc.ts` can raise it from any call site and
 * `ClientVersionGate` shows the reload screen. It only ever turns on: the
 * cure is a reload.
 */

let outdated = false
const listeners = new Set<() => void>()

export function reportClientOutdated(): void {
  if (outdated) return
  outdated = true
  for (const l of listeners) l()
}

export function isClientReportedOutdated(): boolean {
  return outdated
}

export function subscribeClientOutdated(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tests only. */
export function resetClientOutdatedForTest(): void {
  outdated = false
}
