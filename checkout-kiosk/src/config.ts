// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { BRIDGE_MODE } from "./mode.generated"
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
}

const DEFAULT_URLS: Record<BridgeMode, string> = {
  kiosk: "https://localhost:5173/?kiosk",
  admin: "https://localhost:5174/",
}

function urlEnvVar(mode: BridgeMode): string {
  return mode === "kiosk" ? "BRIDGE_KIOSK_URL" : "BRIDGE_ADMIN_URL"
}

export function resolveConfig(): BridgeConfig {
  const mode = BRIDGE_MODE
  const url = process.env[urlEnvVar(mode)] ?? DEFAULT_URLS[mode]
  const isDev = url.includes("localhost")
  const bearer = process.env.BRIDGE_BEARER_KEY ?? ""

  if (!bearer && !isDev) {
    console.error(
      "FATAL: BRIDGE_BEARER_KEY env var is required in production. " +
        "Refusing to start."
    )
    process.exit(1)
  }

  return {
    mode,
    url,
    bearer,
    isDev,
    partition: mode === "kiosk" ? "persist:kiosk:volatile" : "persist:admin",
    productName: mode === "kiosk" ? "OWW Kiosk" : "OWW Admin",
    windowOpts: {
      width: mode === "kiosk" ? 1280 : 1400,
      height: 900,
      autoHideMenuBar: mode === "kiosk",
      showResetButton: mode === "kiosk",
    },
  }
}
