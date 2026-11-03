// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

export interface DispatchSearch {
  picc?: string
  cmac?: string
  kiosk?: string
  from?: string
}

/**
 * The search params the root dispatcher carries onto the wizard step it
 * forwards to: the tag tap, the kiosk flag and the old checkout's `from`.
 */
export function dispatchSearch({ picc, cmac, kiosk, from }: DispatchSearch): DispatchSearch {
  const search: DispatchSearch = {}
  if (picc) search.picc = picc
  if (cmac) search.cmac = cmac
  if (kiosk !== undefined) search.kiosk = ""
  if (from) search.from = from
  return search
}
