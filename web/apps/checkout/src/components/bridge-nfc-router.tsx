// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useBridge } from "@modules/lib/use-bridge"

/**
 * Kiosk-mode bridge listener. When an NFC tag is read by the Electron
 * hardware bridge, parse `picc`/`cmac` from the tag's NDEF URL and
 * client-side-navigate to `/` with those params.
 *
 * Issue #314 (option 2 in plan §F): the Electron renderer used to do
 * `webview.src = …` which forced a full page reload on every tap. The
 * client-side `navigate(...)` here preserves React state and is
 * router-aware, matching how the rest of the app handles navigation.
 */
export function BridgeNfcRouter(): null {
  const bridge = useBridge()
  const navigate = useNavigate()

  useEffect(() => {
    if (!bridge.available) return
    if (!bridge.features.includes("nfc")) return

    return bridge.onNfcTag(({ url }) => {
      if (!url) return
      try {
        const parsed = new URL(url)
        const picc =
          parsed.searchParams.get("picc") ?? parsed.searchParams.get("e")
        const cmac =
          parsed.searchParams.get("cmac") ?? parsed.searchParams.get("m")
        if (!picc || !cmac) return
        // TanStack Router types the `search` shape per route. We're forcing
        // navigation to `/` regardless of the current route, so cast to the
        // permissive shape the index route validates against.
        navigate({
          to: "/",
          search: { picc, cmac, kiosk: "" } as Record<string, string>,
          replace: true,
        })
      } catch (err) {
        console.error("Failed to parse NFC URL:", err)
      }
    })
  }, [bridge.available, bridge.features, bridge.onNfcTag, navigate])

  return null
}
