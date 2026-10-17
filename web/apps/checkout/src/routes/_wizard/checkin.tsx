// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router"
import { QrCode } from "lucide-react"
import { toast } from "sonner"
import { isProfileComplete } from "@modules/lib/auth"
import { useDb } from "@modules/lib/firebase-context"
import { useDocument } from "@modules/lib/firestore"
import { userRef } from "@modules/lib/firestore-helpers"
import { useBridge } from "@modules/lib/use-bridge"
import { StepCheckin } from "@/components/checkout/step-checkin"
import { useWizardContext } from "@/components/checkout/wizard-context"
import { registerCheckinScreen } from "@/components/checkout/kiosk-session-guard"
import { isStartedVisit } from "@/components/checkout/visit-state"
import { ACTIVITY_EVENTS } from "@/components/checkout/kiosk-idle-dialog"

export const Route = createFileRoute("/_wizard/checkin")({
  component: CheckinRoute,
})

/** Kiosk badge tap: "Besuch starten" fills and fires after this long. */
const AUTO_START_MS = 5_000
/** How long the start screen confirms the visit that was just started. */
const STARTED_TOAST_MS = 6_000
/**
 * How long a second badge's tap waits for the pending visit's write. A write
 * that never settles (Firestore unreachable) must not swallow the tap: the
 * kiosk would stay stuck until the idle reset.
 */
export const START_HANDOFF_TIMEOUT_MS = 8_000
const START_STALLED_MESSAGE =
  "Der Besuch konnte nicht gestartet werden – keine Verbindung zum Server."

class StartStalledError extends Error {}

function startedToastMessage(firstName: string): string {
  return `Besuch von ${firstName} gestartet. Viel Spass in der Werkstatt!`
}

/**
 * One-shot countdown decision (issue #732). "undecided" until everything it
 * depends on has loaded; then "running" or "off" for the rest of this screen.
 * A touch, a dialog or the start itself turns "running" into "off".
 */
type CountdownState = "undecided" | "running" | "off"

function CheckinRoute() {
  const navigate = useNavigate()
  const ctx = useWizardContext()
  const db = useDb()
  const bridge = useBridge()
  const search = useSearch({ from: "/_wizard" })
  const rescan = search.rescan === "1"

  // ── Start-screen confirmation ─────────────────────────────────────────
  // The reset after "Besuch starten" wipes storage, so the visitor's first
  // name rides through the reload as `?started=`. Show it once, then strip
  // it so a later reload doesn't repeat it.
  const started = search.started
  useEffect(() => {
    if (!started) return
    toast.success(startedToastMessage(started), {
      // A fixed id dedupes StrictMode's double effect run.
      id: "kiosk-visit-started",
      duration: STARTED_TOAST_MS,
    })
    const rest = { ...search }
    delete rest.started
    navigate({ to: "/checkin", search: rest, replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started])

  // ── Auto-start countdown (kiosk badge tap only) ───────────────────────
  // Not for a code sign-in (no badge), not in a browser (no bridge), not
  // with an open checkout (TagVisitRedirect or "Material erfassen" own that)
  // and not while the welcome onboarding has to run first.
  const candidate = bridge.available && ctx.kiosk && ctx.identifiedByBadge
  const badgeUserId = candidate ? (ctx.identifiedUserRef?.id ?? null) : null
  const profileRef = useMemo(
    () => (badgeUserId ? userRef(db, badgeUserId) : null),
    [db, badgeUserId],
  )
  const { data: profileDoc } = useDocument(profileRef)
  const [countdown, setCountdown] = useState<CountdownState>("undecided")
  if (
    countdown === "undecided" &&
    candidate &&
    !ctx.openCheckoutLoading &&
    !ctx.tagAuthLoading &&
    profileDoc
  ) {
    setCountdown(
      !ctx.openCheckout && isProfileComplete(profileDoc) ? "running" : "off",
    )
  }

  // A touch while the decision is still loading counts too: the person is
  // already busy with the screen, so the countdown must not start later.
  const deciding = countdown === "undecided" && candidate
  useEffect(() => {
    if (!deciding) return
    const touched = () => setCountdown("off")
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, touched, { capture: true, passive: true })
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, touched, { capture: true })
      }
    }
  }, [deciding])

  const firstName =
    ctx.identifiedFirstName ??
    (ctx.persons.find((p) => p.userId === ctx.identifiedUserRef?.id)
      ?.firstName.trim() ||
      null)

  // One start per screen: the countdown, a click and a second badge's tap
  // (BridgeNfcRouter → startPendingVisit) all share the same write.
  const startRef = useRef<Promise<void> | null>(null)
  // Set once BridgeNfcRouter took over the reset (switch to the next badge).
  const handedOffRef = useRef(false)
  // A start whose write outlived START_HANDOFF_TIMEOUT_MS. It may still land,
  // but later taps must not join it again — they ask instead.
  const stalledRef = useRef<Promise<void> | null>(null)
  const persistVisit = useCallback((): Promise<void> => {
    if (!startRef.current) {
      // Ticked companions are saved first, so the persisted lines carry
      // their saved person (#605) — the countdown, a click and a second
      // badge's tap all end up here. Over a purchase-only checkout the
      // persons' types make it a visit (KIO-18).
      const p = ctx
        .saveCompanions()
        .then((persons) => ctx.persistPersons({ persons }))
      startRef.current = p
      p.catch(() => {
        // persistPersons already toasted (ADR-0025); allow a retry.
        if (startRef.current === p) startRef.current = null
      })
    }
    return startRef.current
  }, [ctx])

  // Kiosk primary action: check in (create the checkout) WITHOUT navigating
  // to /visit — the visitor is done at the terminal — then free the kiosk.
  // The start screen confirms it with a toast.
  //
  // Issue #467: only offer "Besuch starten" when the kiosk visitor is
  // already identified (tag-tap or signed in). For a truly anonymous kiosk
  // guest the checkout is bound to a throwaway anon session that they can't
  // return to, so "starting a visit" they'd immediately lose is pointless —
  // they keep the plain "Weiter" flow instead.
  const onStartVisit =
    ctx.kiosk && !ctx.isAnonymous
      ? async () => {
          setCountdown("off")
          try {
            await persistVisit()
          } catch {
            // Already toasted; stay on /checkin (no timer) for a retry.
            return
          }
          if (handedOffRef.current) return
          await ctx.startOver({ startedHint: firstName })
        }
      : undefined

  // Publish the screen state for BridgeNfcRouter's tap-time decision. Read
  // through a ref so the registered getter is always current.
  const visitStarted = isStartedVisit(ctx.openCheckout)
  // Identified, no started visit, no countdown (touched, or a code sign-in).
  // A badge tap still deciding about its countdown counts as untouched.
  const onCheckinScreen =
    ctx.kiosk &&
    !ctx.isAnonymous &&
    !ctx.openCheckoutLoading &&
    !visitStarted &&
    (countdown === "off" || !candidate)
  const screenRef = useRef({
    countdownRunning: false,
    onCheckinScreen: false,
    holderFirstName: null as string | null,
  })
  const startPendingRef = useRef<() => Promise<string | null>>(async () => null)
  useEffect(() => {
    screenRef.current = {
      countdownRunning: countdown === "running",
      onCheckinScreen,
      holderFirstName: firstName,
    }
    startPendingRef.current = async () => {
      handedOffRef.current = true
      setCountdown("off")
      const start = persistVisit()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          start,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new StartStalledError()),
              START_HANDOFF_TIMEOUT_MS,
            )
          }),
        ])
      } catch (err) {
        // Not handed off after all: should the write still land, the
        // countdown/click path resets the kiosk as usual.
        handedOffRef.current = false
        if (err instanceof StartStalledError) {
          stalledRef.current = start
          toast.error(START_STALLED_MESSAGE)
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
      return firstName
    }
  })
  useEffect(
    () =>
      registerCheckinScreen({
        getState: () => {
          const { countdownRunning, onCheckinScreen, holderFirstName } =
            screenRef.current
          // A start in flight still counts as pending: the tap then joins
          // that write instead of asking — unless it already stalled.
          const autoStartPending =
            countdownRunning ||
            (startRef.current !== null && startRef.current !== stalledRef.current)
          return {
            autoStartPending,
            onCheckinScreen: onCheckinScreen && !autoStartPending,
            holderFirstName,
          }
        },
        startPendingVisit: () => startPendingRef.current(),
      }),
    [],
  )

  return (
    <>
      {rescan && (
        <div className="mb-6 flex items-start gap-3 rounded-md border border-cog-teal/40 bg-cog-teal/5 px-4 py-3">
          <QrCode className="h-5 w-5 mt-0.5 shrink-0 text-cog-teal-dark" aria-hidden />
          <p className="text-sm text-foreground">
            Bitte zuerst einchecken — danach den QR-Code nochmals scannen,
            um das Material hinzuzufügen.
          </p>
        </div>
      )}
      <StepCheckin
        persons={ctx.persons}
        personsDispatch={ctx.personsDispatch}
        isAnonymous={ctx.isAnonymous}
        kiosk={ctx.kiosk}
        isAccountLoggedIn={ctx.isAccountLoggedIn}
        signedInUserId={ctx.identifiedUserDoc?.id ?? null}
        signedInEmail={ctx.identifiedUserDoc?.email ?? null}
        // The identified principal (account OR tag-tap badge user) owns the
        // checkout and always stays on the roster.
        ownerUserId={ctx.identifiedUserRef?.id ?? null}
        isMember={ctx.isMember}
        config={ctx.pricingConfig}
        feePersons={ctx.feePersons}
        savedPersons={ctx.savedPersons}
        onDeleteSavedPerson={ctx.deleteSavedPerson}
        // Issue #465: a started visit flips the kiosk footer primary from
        // "Besuch starten" to "Material erfassen". A purchase-only
        // checkout keeps "Besuch starten".
        visitStarted={visitStarted}
        autoStartMs={countdown === "running" ? AUTO_START_MS : undefined}
        onCountdownCancel={() => setCountdown("off")}
        // Kiosk: badge-tap progress/errors render inside the NFC affordance
        // box on this page (TagAuthOverlay stays home for browser tag taps).
        tagAuthLoading={ctx.tagAuthLoading}
        tagAuthError={ctx.tagAuthError}
        picc={ctx.picc}
        onAdvance={async () => {
          // Issue #151: eager anonymous sign-in so /visit can write items.
          if (ctx.isAnonymous) await ctx.signInAnonymouslyIfNeeded()
          // Issue #605: keep ticked companions first so the persisted lines
          // link to them; never blocks the advance.
          const persons = await ctx.saveCompanions()
          try {
            // Issue #246: persist the person roster onto the open checkout doc.
            await ctx.persistPersons({ persons })
          } catch {
            // persistPersons already toasted (ADR-0025) and re-threw; stay on
            // /checkin so the user can retry instead of bouncing to the
            // no-checkout gate on /visit.
            return
          }
          navigate({
            to: "/visit",
            search: ctx.kiosk ? { kiosk: "" } : {},
          })
        }}
        onStartVisit={onStartVisit}
      />
    </>
  )
}
