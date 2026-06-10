// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useBridge } from "@modules/lib/use-bridge"

// A tap that can't even be routed (NDEF read failed, or the URL lacks the
// SDM params) used to be silently swallowed — the kiosk gave zero feedback
// and users assumed the reader was broken. Surface it as a toast; the
// verify-in-progress feedback lives in TagAuthOverlay.
const UNREADABLE_TAG_MESSAGE =
  "Badge konnte nicht gelesen werden. Bitte nochmals auflegen."

/**
 * Kiosk-mode bridge listener. When an NFC tag is read by the Electron
 * hardware bridge, parse `picc`/`cmac` from the tag's NDEF URL and
 * client-side-navigate to `/checkin` with those params.
 *
 * Issue #314 (option 2 in plan §F): the Electron renderer used to do
 * `webview.src = …` which forced a full page reload on every tap. The
 * client-side `navigate(...)` here preserves React state and is
 * router-aware, matching how the rest of the app handles navigation.
 *
 * Issue #420: navigate straight to the wizard's canonical tag entry
 * (`/checkin`), NOT the `/` dispatcher. Going via `/` verifies the tag
 * there (RootDispatcher's `useTokenAuth`) AND again in the wizard — but
 * each physical tap yields exactly one SDM counter value, and
 * `verify_tag.ts` enforces strict counter monotonicity. The second
 * verify is rejected as a replay, leaving the wizard with `tokenUser =
 * null` / `isTagAuth = false` (neither tag- nor anon-identified), so the
 * badge tap has no effect and only a manual "Neuer Checkout" recovers.
 * Routing to `/checkin` keeps the single wizard-side verify, consuming
 * the counter once. This mirrors the canonical entry the NFC e2e test
 * documents.
 */
export function BridgeNfcRouter(): null {
  const bridge = useBridge()
  const navigate = useNavigate()

  useEffect(() => {
    if (!bridge.available) return
    if (!bridge.features.includes("nfc")) return

    return bridge.onNfcTag(({ url }) => {
      if (!url) {
        toast.error(UNREADABLE_TAG_MESSAGE)
        return
      }
      try {
        const parsed = new URL(url)
        const picc =
          parsed.searchParams.get("picc") ?? parsed.searchParams.get("e")
        const cmac =
          parsed.searchParams.get("cmac") ?? parsed.searchParams.get("m")
        if (!picc || !cmac) {
          toast.error(UNREADABLE_TAG_MESSAGE)
          return
        }
        // TanStack Router types the `search` shape per route. We're forcing
        // navigation to `/checkin` regardless of the current route, so cast
        // to the permissive shape the checkin route validates against.
        navigate({
          to: "/checkin",
          search: { picc, cmac, kiosk: "" } as Record<string, string>,
          replace: true,
        })
      } catch (err) {
        console.error("Failed to parse NFC URL:", err)
        toast.error(UNREADABLE_TAG_MESSAGE)
      }
    })
  }, [bridge.available, bridge.features, bridge.onNfcTag, navigate])

  return null
}
