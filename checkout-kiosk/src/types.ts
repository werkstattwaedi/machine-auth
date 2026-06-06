// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { VariantPrice } from "@oww/shared"

export type BridgeMode = "kiosk" | "admin"

// Payload pushed to the renderer/webview when an NTAG 424 DNA tag is tapped.
// `physicalUid` is the raw chip UID exposed by PC/SC — useful for low-level
// diagnostics, but NOT the canonical tag ID. Our tags use PICC randomization
// (SDM), so the canonical ID only falls out of server-side decoding of the
// `picc`/`cmac` parameters carried inside `url`.
export interface NfcTagEvent {
  physicalUid: string
  url?: string
}

export interface Bridge {
  mode: BridgeMode
  features: readonly string[]
  bearer: () => Promise<string | null>
  resetSession: () => Promise<void>
  getUrl: () => Promise<string>
  onUrlChange: (cb: (url: string) => void) => () => void
  onNfcTag: (cb: (payload: NfcTagEvent) => void) => () => void
}

// Compile-time proof that the kiosk can resolve @oww/shared.
export type { VariantPrice }
