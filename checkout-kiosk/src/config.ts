// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { withEnvLabel } from "@oww/shared"

import {
  BRIDGE_BEARER_KEY,
  BRIDGE_ENV_LABEL,
  BRIDGE_URL,
} from "./build-config.generated"
import type { BridgeMode } from "./types"

/** Base product name; the OS window title is this plus the env label. */
export const PRODUCT_NAME = "OWW Self Checkout"

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

export function resolveConfig(): BridgeConfig {
  const url = BRIDGE_URL
  // Anything still pointing at localhost is by definition a dev build;
  // `inject-build-config.mjs` enforces that production builds carry a
  // real URL + bearer.
  const isDev = url.includes("localhost")

  return {
    mode: "kiosk",
    url,
    bearer: BRIDGE_BEARER_KEY,
    isDev,
    // Volatile partition: a closed kiosk window equals a closed session.
    partition: "persist:kiosk:volatile",
    // "[staging] OWW Self Checkout" on non-prod builds (BRIDGE_ENV_LABEL
    // comes from the ops config's web.envLabel via inject-build-config).
    productName: withEnvLabel(BRIDGE_ENV_LABEL, PRODUCT_NAME),
    windowOpts: {
      width: 1280,
      height: 900,
      autoHideMenuBar: true,
      showResetButton: true,
    },
  }
}
