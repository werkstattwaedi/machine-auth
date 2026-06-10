// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useBridge } from "@modules/lib/use-bridge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { isKioskSessionPreservable } from "./checkout/kiosk-session-guard"

// A tap that can't even be routed (NDEF read failed, or the URL lacks the
// SDM params) used to be silently swallowed — the kiosk gave zero feedback
// and users assumed the reader was broken. Surface it as a toast; the
// verify-in-progress feedback lives in TagAuthOverlay.
const UNREADABLE_TAG_MESSAGE =
  "Badge konnte nicht gelesen werden. Bitte nochmals auflegen."

interface PendingTag {
  picc: string
  cmac: string
}

/**
 * Confirmed badge switch: wipe the Electron partition (previous user's
 * Firebase Auth + IndexedDB) and hard-reload straight into a /checkin that
 * carries the NEW tag's params — the fresh page verifies the new badge with
 * zero leftover React/Firebase state from the previous session. The picc/
 * cmac were never verified before the dialog, so the SDM counter is clean.
 *
 * Dependency-injected (same pattern as start-over.ts) for unit testing.
 */
export async function confirmTagSwitch(deps: {
  tag: PendingTag
  resetSession: () => Promise<void>
  reload: (target: string) => void
}): Promise<void> {
  try {
    await deps.resetSession()
  } catch (err) {
    console.error("Tag switch: bridge.resetSession failed", err)
  }
  const params = new URLSearchParams({
    kiosk: "",
    picc: deps.tag.picc,
    cmac: deps.tag.cmac,
  })
  deps.reload(`/checkin?${params.toString()}`)
}

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
 *
 * Session protection: when the wizard reports in-progress state worth
 * keeping (open checkout, cart items, typed-in persons — the same
 * `hasPreservableState` the idle watcher uses), a tap does NOT navigate
 * straight away. A confirmation dialog asks whether to end the current
 * session; confirming wipes the bridge partition and hard-reloads into
 * /checkin with the new tag's params, so nothing of the previous user
 * leaks into the new session.
 */
export function BridgeNfcRouter() {
  const bridge = useBridge()
  const navigate = useNavigate()
  const [pendingTag, setPendingTag] = useState<PendingTag | null>(null)

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
        // Another visitor's session is still in progress — confirm before
        // discarding it. A later tap while the dialog is up replaces the
        // pending tag (the newest badge wins the confirmation).
        if (isKioskSessionPreservable()) {
          setPendingTag({ picc, cmac })
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

  if (!pendingTag) return null

  return (
    <AlertDialog open>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Neuer Badge erkannt</AlertDialogTitle>
          <AlertDialogDescription>
            Auf diesem Terminal ist noch ein Besuch aktiv. Mit dem neuen
            Badge fortfahren? Die aktuelle Sitzung wird beendet — ein
            offener Besuch bleibt bestehen und erscheint wieder, wenn der
            zugehörige Badge aufgelegt wird.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            variant="outline"
            onClick={() => setPendingTag(null)}
          >
            Abbrechen
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() =>
              void confirmTagSwitch({
                tag: pendingTag,
                resetSession: bridge.resetSession,
                reload: (target) => window.location.replace(target),
              })
            }
          >
            Mit neuem Badge fortfahren
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
