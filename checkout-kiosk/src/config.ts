// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import {
  BRIDGE_BEARER_KEY,
  BRIDGE_MODE,
  BRIDGE_PRINTER_HOST,
  BRIDGE_URL,
} from "./build-config.generated"
import { parsePrinterEndpoint, type PrinterEndpoint } from "./bridge/printer"
import type { BridgeMode } from "./types"

export interface BridgeConfig {
  mode: BridgeMode
  url: string
  bearer: string
  partition: string
  isDev: boolean
  productName: string
  windowOpts: {
    width: number
    height: number
    autoHideMenuBar: boolean
    showResetButton: boolean
  }
  /** Resolved from the baked `BRIDGE_PRINTER_HOST` build constant
   *  (e.g. `labeler.internal:9100`). `null` when empty → bridge does
   *  not advertise the `"print"` feature. */
  printer: PrinterEndpoint | null
}

export function resolveConfig(): BridgeConfig {
  const mode = BRIDGE_MODE
  const url = BRIDGE_URL
  // Anything still pointing at localhost is by definition a dev build;
  // `inject-build-config.mjs` enforces that production builds carry a
  // real URL + bearer.
  const isDev = url.includes("localhost")

  return {
    mode,
    url,
    bearer: BRIDGE_BEARER_KEY,
    isDev,
    partition: mode === "kiosk" ? "persist:kiosk:volatile" : "persist:admin",
    productName: mode === "kiosk" ? "OWW Kiosk" : "OWW Admin",
    windowOpts: {
      width: mode === "kiosk" ? 1280 : 1400,
      height: 900,
      autoHideMenuBar: mode === "kiosk",
      showResetButton: mode === "kiosk",
    },
    printer: parsePrinterEndpoint(BRIDGE_PRINTER_HOST),
  }
}
