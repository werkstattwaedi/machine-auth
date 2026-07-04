// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@modules/components/ui/button"
import "./nfc-badge-affordance.css"

/**
 * Animated "hold your badge to the reader" affordance on the kiosk
 * check-in page (design handoff "NFC Badge Affordance", variant A).
 *
 * One box, four states:
 *   - hero: large animated scene (OWW fob gliding onto the ACS reader)
 *     while the form is untouched, plus a QR to the checkout app for the
 *     own-device path. Rendered below the typed form behind an "ODER"
 *     divider — the badge is the alternative, not the gate.
 *   - compact: slim one-line bar once the visitor focuses or types into
 *     the form, so anonymous check-in is undisturbed. Re-expands when
 *     the form goes back to empty.
 *   - verifying: the badge-tap progress feedback folded into the box
 *     (previously a full-screen TagAuthOverlay): solid teal, spinner,
 *     "Badge erkannt". The physical NFC read is near-instant but the
 *     verify RPC + Firebase sign-in take seconds — without feedback
 *     users re-tapped and burned the SDM counter on replay-rejected
 *     verifies.
 *   - error: the badge-read failure folded into the box. Dismissal is
 *     keyed on `picc` — each physical tap mints a fresh picc, so a new
 *     tap after dismissing surfaces a new failure while re-renders of
 *     the same failed tap stay dismissed.
 *
 * After a successful tap the parent stops rendering the affordance
 * entirely (the visitor is identified; the pre-filled identity strip
 * takes over) — there is no persistent "tap again" state.
 */
export interface NfcBadgeAffordanceProps {
  /** True while the visitor interacts with the form (focus or typed
   *  content) — collapses the hero scene to the slim bar. */
  collapsed: boolean
  /** True while a tapped badge is verified (wizard `tagAuthLoading`). */
  verifying: boolean
  /** Badge verification failure (wizard `tagAuthError`); null otherwise. */
  error: string | null
  /** Tap nonce the error dismissal is keyed on (wizard `picc`). */
  picc?: string
}

type AffordanceMode = "hero" | "compact" | "verifying" | "error"

const CONTAINER_CLASSES: Record<AffordanceMode, string> = {
  hero: "h-auto rounded-md bg-cog-teal-light",
  compact: "h-[46px] rounded-[3px] border border-cog-teal/30 bg-cog-teal/5",
  verifying: "h-32 rounded-md bg-cog-teal",
  error: "h-auto rounded-[3px] border border-[#cc2a24]/40 bg-[#fce4e4]/60",
}

export function NfcBadgeAffordance({
  collapsed,
  verifying,
  error,
  picc,
}: NfcBadgeAffordanceProps) {
  const [dismissedPicc, setDismissedPicc] = useState<string | null>(null)

  const showError = !!error && !!picc && picc !== dismissedPicc
  const mode: AffordanceMode = verifying
    ? "verifying"
    : showError
      ? "error"
      : collapsed
        ? "compact"
        : "hero"

  return (
    <div
      data-testid="nfc-affordance"
      data-mode={mode}
      // role="status" already implies polite announcements; only the
      // error interrupts (role="alert" + assertive).
      role={mode === "verifying" ? "status" : mode === "error" ? "alert" : undefined}
      aria-live={mode === "error" ? "assertive" : undefined}
      // flex/justify-center vertically centres the layer against the
      // container's *live* animated height every frame. An inner h-full
      // percentage chain did not track the height tween — the content pinned
      // to the top while the box grew, then snapped to centre the instant the
      // animation finished.
      className={`flex flex-col justify-center overflow-hidden transition-all duration-450 ${CONTAINER_CLASSES[mode]}`}
    >
      {/* key={mode} remounts the layer so tw-animate's fade-in plays on
          every state switch while the container height/color tweens. */}
      <div key={mode} className="w-full animate-in fade-in duration-300">
        {mode === "hero" && <HeroLayer />}
        {mode === "compact" && <CompactLayer />}
        {mode === "verifying" && <VerifyingLayer />}
        {mode === "error" && (
          <ErrorLayer
            error={error!}
            onDismiss={() => setDismissedPicc(picc ?? null)}
          />
        )}
      </div>
    </div>
  )
}

function HeroLayer() {
  return (
    <div className="flex items-center gap-5 px-5 py-5 sm:gap-7 sm:px-7">
      <ReaderScene />
      <div className="min-w-0 flex-1">
        <div className="nfx-headline text-[19px] font-bold leading-tight">
          <span className="nfx-swash">Badge</span> an den Leser halten
        </div>
        {/* The member-pricing pitch that used to live here moved into the
            account section's field note; the "scan to continue on your
            phone" QR was dropped with it (self-checkout no longer requires
            the badge — design handoff "Kiosk sign-in flow redesign"). */}
        <p className="mt-1 max-w-[52ch] text-[13.5px] text-muted-foreground">
          Um einen neuen Besuch zu starten oder den jetzigen abzuschliessen
        </p>
      </div>
    </div>
  )
}

function CompactLayer() {
  return (
    <div className="flex items-center gap-3 px-4 text-cog-teal">
      <MiniFobIcon />
      <span className="text-[13.5px] text-muted-foreground">
        Badge an den Leser halten, um deine Daten zu laden
      </span>
    </div>
  )
}

function VerifyingLayer() {
  return (
    <div className="flex items-center gap-4 px-6 text-white">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/25">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </span>
      <div>
        <div className="nfx-headline text-[17px] font-bold">Badge erkannt</div>
        <div className="mt-0.5 text-[13px] text-white/85">
          Deine Daten werden geladen — einen Moment bitte …
        </div>
      </div>
    </div>
  )
}

function ErrorLayer({
  error,
  onDismiss,
}: {
  error: string
  onDismiss: () => void
}) {
  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <AlertTriangle className="h-7 w-7 shrink-0 text-[#cc2a24]" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-bold">Badge konnte nicht gelesen werden</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Bitte lege den Badge nochmals auf. Falls das Problem bestehen
          bleibt, melde dich beim Werkstatt-Team.
        </p>
        {/* Raw error for staff debugging — server messages may be
            technical/English, hence the generic headline above. */}
        <p className="mt-1 break-words text-xs text-muted-foreground/70">
          {error}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onDismiss}>
        Schliessen
      </Button>
    </div>
  )
}

/**
 * Hero scene: the real hardware members see at the terminal — the white
 * teardrop OWW fob (gold stripe, keyring hole) gliding onto the black
 * ACS reader (white N-mark, cable stub, gold-blinking LED slit).
 */
function ReaderScene() {
  return (
    <svg
      className="h-auto w-[150px] shrink-0 sm:w-[215px]"
      viewBox="0 0 230 96"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="nfx-fob-clip">
          <path d="M34 26 C18 26 8 35.5 8 48 C8 60.5 18 70 34 70 L66 64.5 C74.5 63 79 57.5 79 48 C79 38.5 74.5 33 66 31.5 Z" />
        </clipPath>
      </defs>
      {/* Reader (black ACS box, cable to the top) */}
      <path d="M178 0 v5" stroke="#2a2a2a" strokeWidth="4" />
      <rect x="148" y="4" width="58" height="88" rx="10" fill="#1f1f1f" />
      <rect
        x="153"
        y="15"
        width="48"
        height="71"
        rx="7"
        stroke="rgba(255,255,255,.16)"
        strokeWidth="1.5"
      />
      <rect
        className="nfx-led"
        x="159"
        y="8.5"
        width="13"
        height="3.5"
        rx="1.75"
        fill="#3a3a3a"
      />
      {/* N-mark */}
      <g transform="skewX(-6)">
        <rect x="169" y="34" width="26" height="26" rx="6" fill="#fff" />
        <path
          d="M176 53 V41 M188 41 v12 M176 41 l12 12"
          stroke="#1f1f1f"
          strokeWidth="3"
          strokeLinecap="square"
        />
      </g>
      {/* OWW teardrop fob (animated) */}
      <g className="nfx-card">
        <path
          d="M34 26 C18 26 8 35.5 8 48 C8 60.5 18 70 34 70 L66 64.5 C74.5 63 79 57.5 79 48 C79 38.5 74.5 33 66 31.5 Z"
          fill="#fff"
          stroke="#bdbdbd"
          strokeWidth="2"
        />
        <polygon
          points="9,39.5 75,42.5 75,55.5 9,52.5"
          fill="var(--color-oww-gold)"
          clipPath="url(#nfx-fob-clip)"
        />
        <text
          x="19"
          y="54"
          fontFamily="Bitter, Georgia, serif"
          fontSize="17"
          fontWeight="700"
          fill="#1a1a1a"
          transform="rotate(-2 45 48)"
        >
          OWW
        </text>
        <circle
          cx="68"
          cy="48"
          r="4.5"
          fill="var(--color-cog-teal-light)"
          stroke="#bdbdbd"
          strokeWidth="1.5"
        />
      </g>
      {/* Ripples on contact — drawn above the fob */}
      <g className="nfx-rip nfx-rip-1">
        <circle
          cx="177"
          cy="47"
          r="10"
          stroke="var(--color-cog-teal)"
          strokeWidth="2.5"
          fill="none"
        />
      </g>
      <g className="nfx-rip nfx-rip-2">
        <circle
          cx="177"
          cy="47"
          r="10"
          stroke="var(--color-cog-teal)"
          strokeWidth="2"
          fill="none"
        />
      </g>
    </svg>
  )
}

/**
 * Compact-bar pictogram: mini teardrop fob with pulsing contactless
 * arcs — same iconography as the hero scene once collapsed.
 */
function MiniFobIcon() {
  return (
    <svg
      className="shrink-0"
      width="35"
      height="24"
      viewBox="0 0 38 26"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="nfx-mini-fob-clip">
          <path d="M12 4.5 C6 4.5 2 7.9 2 13 C2 18.1 6 21.5 12 21.5 L20.5 19.8 C24.3 19 26.5 16.6 26.5 13 C26.5 9.4 24.3 7 20.5 6.2 Z" />
        </clipPath>
      </defs>
      <path
        d="M12 4.5 C6 4.5 2 7.9 2 13 C2 18.1 6 21.5 12 21.5 L20.5 19.8 C24.3 19 26.5 16.6 26.5 13 C26.5 9.4 24.3 7 20.5 6.2 Z"
        fill="#fff"
        stroke="currentColor"
        strokeWidth="2"
      />
      <polygon
        points="2,10 27,11.2 27,16.2 2,15"
        fill="var(--color-oww-gold)"
        clipPath="url(#nfx-mini-fob-clip)"
      />
      <circle
        cx="21"
        cy="13"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        className="nfx-arc"
        d="M30 9a5.5 5.5 0 0 1 0 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        className="nfx-arc nfx-arc-2"
        d="M34 6.5a9.5 9.5 0 0 1 0 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
