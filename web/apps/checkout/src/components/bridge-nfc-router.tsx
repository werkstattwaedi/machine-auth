// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useBridge, resolveBridgeBearer } from "@modules/lib/use-bridge"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { getKioskSessionState } from "./checkout/kiosk-session-guard"
import {
  BadgePurchaseDialog,
  type BadgePurchaseOffer,
} from "./checkout/badge-purchase-dialog"

// A tap that can't even be routed (NDEF read failed, or the URL lacks the
// SDM params) used to be silently swallowed — the kiosk gave zero feedback
// and users assumed the reader was broken. Surface it as a toast; the
// verify-in-progress feedback lives in TagAuthOverlay.
const UNREADABLE_TAG_MESSAGE =
  "Badge konnte nicht gelesen werden. Bitte nochmals auflegen."

interface PendingTag {
  picc: string
  cmac: string
  // Was the session being interrupted already identified (signed-in account
  // or authenticated badge)? Decides which confirmation to show:
  //   - identified: a real badge→badge handoff — the open visit survives and
  //     reappears when its badge is tapped, so the benign black confirm is
  //     honest.
  //   - anonymous: a first badge tap upgrading an anon visit — confirming
  //     discards the in-progress checkout for good (no badge ties to it), so
  //     the dialog must be honest about the loss and use the red destructive
  //     confirm, matching "Neuer Checkout" (issue #468).
  identified: boolean
  // Name of the current (identified) visitor, when known — so the handoff
  // dialog can say whose visit is being parked. Null for anonymous sessions
  // (which use the discard copy and never show a name) or when no name is on
  // record. The NEW badge's name is NOT available here: it isn't verified
  // until the post-confirm reload (verifying twice would burn the SDM
  // counter, see the routing note above), so we can only name the visitor
  // being interrupted, not the one tapping in.
  holderName: string | null
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
  // Only the verified-later SDM params matter to the reload — the dialog's
  // identified/anonymous framing is consumed before we get here.
  tag: Pick<PendingTag, "picc" | "cmac">
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
  const functions = useFunctions()
  const navigate = useNavigate()
  const [pendingTag, setPendingTag] = useState<PendingTag | null>(null)
  const [badgeOffer, setBadgeOffer] = useState<BadgePurchaseOffer | null>(null)
  const [signInFirstOpen, setSignInFirstOpen] = useState(false)

  useEffect(() => {
    if (!bridge.available) return
    if (!bridge.features.includes("nfc")) return

    /**
     * Mid-session tap: before choosing which confirmation to show, ask the
     * server whether the badge is registered at all — WITHOUT consuming the
     * one-shot SDM counter (probeTag does no counter advance, issue #420).
     * An unregistered self-service badge must NOT trigger the switch/discard
     * dialog: the session stays untouched and we offer the purchase instead.
     */
    const probeMidSessionTap = async (
      picc: string,
      cmac: string,
      session: ReturnType<typeof getKioskSessionState>
    ) => {
      try {
        const bearer = await resolveBridgeBearer()
        const probeTag = rpcCallable<
          { picc: string; cmac: string; bearer?: string },
          { tokenId: string; registered: boolean; badgeVoucher?: string }
        >(functions, "authCall", "probeTag")
        const { data } = await probeTag({
          picc,
          cmac,
          bearer: bearer ?? undefined,
        })
        if (!data.registered && data.badgeVoucher) {
          if (session.identified) {
            setBadgeOffer({
              tokenId: data.tokenId,
              badgeVoucher: data.badgeVoucher,
            })
          } else {
            // Anonymous with in-progress work: buying needs a sign-in,
            // which would discard the anon session — don't offer either,
            // just explain. The visit in progress stays untouched.
            setSignInFirstOpen(true)
          }
          return
        }
        // Registered badge — the existing switch/discard confirmation.
        setPendingTag({
          picc,
          cmac,
          identified: session.identified,
          holderName: session.holderName,
        })
      } catch (err) {
        console.error("probeTag failed:", err)
        toast.error(UNREADABLE_TAG_MESSAGE)
      }
    }

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
        // A session worth protecting is still in progress — probe first
        // (registered → confirm switch/discard; unregistered → purchase
        // offer). A later tap while a dialog is up replaces the pending
        // state (the newest badge wins). Capture whether that session was
        // already identified so the switch dialog can be honest about
        // whether the open visit survives (identified handoff) or is lost
        // for good (anonymous upgrade — issue #468).
        const session = getKioskSessionState()
        if (session.preservable) {
          void probeMidSessionTap(picc, cmac, session)
          return
        }
        // TanStack Router types the `search` shape per route. We're forcing
        // navigation to `/checkin` regardless of the current route, so cast
        // to the permissive shape the checkin route validates against.
        // (An unregistered badge surfaces there through the wizard's single
        // verify → BadgeOfferCoordinator.)
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
  }, [bridge.available, bridge.features, bridge.onNfcTag, navigate, functions])

  const dialogs = (
    <>
      <BadgePurchaseDialog
        offer={badgeOffer}
        onClose={() => setBadgeOffer(null)}
      />
      <AlertDialog open={signInFirstOpen}>
        <AlertDialogContent data-testid="badge-signin-first-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Neuer Badge erkannt</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Badge gehört noch niemandem. Schliesse zuerst den
              laufenden Checkout ab und melde dich dann an, um ihn zu kaufen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setSignInFirstOpen(false)}>
              Verstanden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  if (!pendingTag) return dialogs

  // Anonymous upgrade: confirming discards the in-progress visit for good —
  // be honest about the loss and make the confirm red/destructive, matching
  // the "Neuer Checkout" flow (start-over-button.tsx). Identified handoff:
  // the open visit survives and reappears when its own badge is tapped, so
  // the benign black confirm and reassuring copy are correct.
  const anonymous = !pendingTag.identified

  return (
    <>
      {dialogs}
      <AlertDialog open>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {anonymous
              ? "Laufenden Checkout verwerfen?"
              : "Benutzer wechseln?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {anonymous ? (
              <>
                Der neue Badge beginnt eine neue Sitzung. Der bisherige
                Checkout wird verworfen.
              </>
            ) : pendingTag.holderName ? (
              <>
                Der Besuch von {pendingTag.holderName} ist zwischengespeichert
                und kann später durch erneutes Auflegen des Badges
                abgeschlossen werden.
              </>
            ) : (
              <>
                Der offene Besuch ist zwischengespeichert und kann später durch
                erneutes Auflegen des Badges abgeschlossen werden.
              </>
            )}
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
            variant={anonymous ? "destructive" : "default"}
            onClick={() =>
              void confirmTagSwitch({
                tag: pendingTag,
                resetSession: bridge.resetSession,
                reload: (target) => window.location.replace(target),
              })
            }
          >
            {anonymous ? "Verwerfen" : "Benutzer wechseln"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
