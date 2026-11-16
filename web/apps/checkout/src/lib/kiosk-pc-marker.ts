// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// "This browser runs on the shared kiosk PC" marker.
//
// Visitors used to open the web checkout in the terminal PC's browser, and
// some still do. That is the regular, personal web checkout on a shared
// machine — none of the kiosk's session wiping or badge handling. The kiosk
// app can't stop a browser from loading the site, so the site stops itself:
// a browser carrying this marker shows a hand-over page to the kiosk app
// instead of the checkout (components/kiosk-pc-gate.tsx).
//
// The marker lives in localStorage and is set by visiting any checkout URL
// with `?kiosk-pc=1` (`?kiosk-pc=0` removes it). It does not survive clearing
// site data, so the terminal's browser uses that URL as its startup page,
// which re-arms it on every browser start.
//
// The parameter is not a secret and can't be one: it sits in the terminal's
// startup settings for anyone to read. What keeps it from spreading by
// accident is that the gate strips it from the address bar once applied, so
// the URL people see and copy on the terminal is the plain one.

export const KIOSK_PC_PARAM = "kiosk-pc"
export const KIOSK_PC_STORAGE_KEY = "oww.kioskPc"

type MarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export type KioskPcParamAction = "arm" | "disarm" | null

/**
 * What the `?kiosk-pc=` parameter in `search` asks for. Only the exact values
 * `1` and `0` count; anything else (a typo, an empty value) does nothing,
 * rather than guessing which way the operator meant.
 */
export function kioskPcParamAction(search: string): KioskPcParamAction {
  const value = new URLSearchParams(search).get(KIOSK_PC_PARAM)
  if (value === "1") return "arm"
  if (value === "0") return "disarm"
  return null
}

/** `search` without the `kiosk-pc` parameter (leading `?` kept when non-empty). */
export function withoutKioskPcParam(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(KIOSK_PC_PARAM)
  const rest = params.toString()
  return rest ? `?${rest}` : ""
}

/**
 * Apply `?kiosk-pc=` (if present) and report whether this browser is marked.
 *
 * Storage access can throw (blocked site data, some private modes); a browser
 * whose storage we cannot use is treated as unmarked, which leaves the web
 * checkout working as it always did.
 */
export function resolveKioskPcMarker(
  search: string,
  storage: MarkerStorage | undefined,
): { marked: boolean; action: KioskPcParamAction } {
  const action = kioskPcParamAction(search)
  if (!storage) return { marked: false, action }
  try {
    if (action === "arm") storage.setItem(KIOSK_PC_STORAGE_KEY, "1")
    if (action === "disarm") storage.removeItem(KIOSK_PC_STORAGE_KEY)
    return { marked: storage.getItem(KIOSK_PC_STORAGE_KEY) === "1", action }
  } catch {
    return { marked: false, action }
  }
}
