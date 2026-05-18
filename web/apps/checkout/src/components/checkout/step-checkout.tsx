// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { Label } from "@modules/components/ui/label"
import { formatCHF } from "@modules/lib/format"
import {
  USAGE_TYPE_LABELS,
  USER_TYPE_LABELS,
  calculateFee,
} from "@modules/lib/pricing"
import { type PricingConfig } from "@modules/lib/workshop-config"
import {
  ArrowLeft,
  ChevronRight,
  Coins,
  Heart,
  Loader2,
  Package,
  Wrench,
} from "lucide-react"
import { cn } from "@modules/lib/utils"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import { PositionTable, rowFromItem } from "@/components/usage/position-table"
import type { UsageType } from "@modules/lib/pricing"

/**
 * Compute up to 4 sensible round-up total targets for the current base.
 *
 * Goal: every suggestion should *feel* like a round number for its
 * magnitude — small bases think in 0.5/1 CHF steps, mid bases in
 * 2/5/10 CHF steps, larger bases in 50/100/500 CHF steps. We avoid
 * "greedy" suggestions by capping the bump at `max(5, base * 10%)`,
 * and avoid arbitrary-looking suggestions (e.g. `195 → 196`) by
 * dropping any candidate that's already swallowed by a much-rounder
 * candidate just slightly above it.
 *
 * Algorithm:
 *   1. Generate candidates by rounding `base` up to each multiple of
 *      a "divisor ladder" `[0.5, 1, 2, 5, 10, 20, 50, 100, ...]`.
 *   2. Keep only candidates within the bump cap.
 *   3. For each unique candidate, remember the *largest* divisor that
 *      produced it (that's its "natural roundness").
 *   4. Dominance filter — drop candidate `c` if a higher candidate `c2`
 *      with a divisor `≥ 4×` larger is within a small gap of it. This
 *      kills the awkward `[196, 200]` style suggestions.
 *   5. Monotonicity filter — when sorted ascending, never go *backwards*
 *      in roundness. E.g. for base ≈ 247 we'd otherwise see `[250, 260]`
 *      where 260 (d=20) is less round than 250 (d=50); the rule drops
 *      260.
 *   6. Return up to 4 entries, ascending. The smallest is the default
 *      (auto-selected when the "Aufrunden" checkbox is on).
 */
export function roundUpOptions(base: number): number[] {
  if (base <= 0) return []
  // If the base is already a whole franc, no round-up is necessary —
  // hide the suggestion row entirely (the Spende input remains for
  // free-form donations).
  if (base % 1 === 0) return []
  // Cap how much we're willing to suggest as a bump. At low bases the
  // 5 CHF floor lets us suggest natural targets like `0.30 → 5`. At
  // high bases the 10% rule keeps us from being greedy.
  const bumpCap = Math.max(5, base * 0.1)
  // "Much rounder, slightly higher" tolerance for the dominance filter.
  const dominanceGap = Math.max(0.5, base * 0.05)
  // Divisors grow geometrically (×2, ×2.5 alternating) and cover the
  // range up to a few thousand francs — enough headroom for any realistic
  // workshop bill.
  const divisors = [
    0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
  ]

  // Build (candidate → largest-divisor-that-produces-it).
  const candidates = new Map<number, number>()
  for (const d of divisors) {
    // Use a small epsilon so a base already at a multiple of `d` rounds
    // to the *next* multiple, not itself.
    const raw = Math.ceil((base + 1e-9) / d) * d
    // Floating-point cleanup: snap to 2 decimal places (Swiss centimes).
    const target = Math.round(raw * 100) / 100
    const bump = target - base
    if (bump <= 0 || bump > bumpCap + 1e-9) continue
    const existing = candidates.get(target)
    if (existing === undefined || d > existing) candidates.set(target, d)
  }

  const sorted = Array.from(candidates.entries()).sort(
    ([a], [b]) => a - b,
  )

  // Step 4 — dominance filter.
  const afterDominance: [number, number][] = sorted.filter(([c, dc]) =>
    !sorted.some(
      ([c2, d2]) =>
        c2 > c && c2 - c <= dominanceGap + 1e-9 && d2 >= dc * 4,
    ),
  )

  // Step 5 — monotonicity filter: walk ascending, drop any entry whose
  // divisor is smaller than the running max.
  let maxDivisorSeen = 0
  const kept: number[] = []
  for (const [c, d] of afterDominance) {
    if (d < maxDivisorSeen) continue
    if (d > maxDivisorSeen) maxDivisorSeen = d
    kept.push(c)
  }

  return kept.slice(0, 4)
}

/** Label for a round-up target. The smallest entry (the "natural next
 *  step") reads "nächsten Franken" / "nächsten halben Franken" so the
 *  sentence "Auf X aufrunden" stays human-friendly. Non-smallest
 *  entries name the target value explicitly; half-franc values are
 *  formatted with one decimal place so e.g. `12.50` doesn't print as
 *  `13 Franken`. */
export function roundUpOptionLabel(target: number, isNextStep: boolean): string {
  if (isNextStep) {
    // Half-franc step only happens for tiny totals or .50-base totals.
    if (target % 1 !== 0) return "nächsten halben Franken"
    return "nächsten Franken"
  }
  if (target % 1 !== 0) return `${target.toFixed(2)} Franken`
  return `${target.toFixed(0)} Franken`
}

interface StepCheckoutProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  onSubmit: () => Promise<void>
  submitting: boolean
  /** Inline alert after a failed submit (ADR-0025). */
  submitError?: string | null
  items: CheckoutItemLocal[]
  config: PricingConfig | null
}

/**
 * Compute the displayed cost breakdown for the receipt step. Mirrors the
 * server-side authoritative {@link recomputeSummary} contract: when
 * {@link usageType} is `"intern"` the visit is never billed, so entry
 * fees, machine cost, and material cost all collapse to 0 regardless of
 * what items / config say. Donation stays honoured. The wizard's
 * `handleSubmit` and `StepCheckout` both flow through this helper so the
 * displayed total always matches what the server will bill.
 */
export function computeCheckoutCosts({
  persons,
  usageType,
  items,
  config,
}: {
  persons: { userType: string }[]
  usageType: UsageType
  items: { origin: string; totalPrice: number }[]
  config: PricingConfig | null
}): { personFees: number; machineCost: number; materialCost: number } {
  // Internal usage is never billed.
  if (usageType === "intern") {
    return { personFees: 0, machineCost: 0, materialCost: 0 }
  }
  const personFees = persons.reduce(
    (sum, p) =>
      sum +
      (calculateFee(
        p.userType as Parameters<typeof calculateFee>[0],
        usageType,
        config,
      ) ?? 0),
    0,
  )
  const machineCost = items
    .filter((i) => i.origin === "nfc")
    .reduce((s, i) => s + i.totalPrice, 0)
  const materialCost = items
    .filter((i) => i.origin !== "nfc")
    .reduce((s, i) => s + i.totalPrice, 0)
  return { personFees, machineCost, materialCost }
}

export function StepCheckout({
  state,
  dispatch,
  onSubmit,
  submitting,
  submitError,
  items,
  config,
}: StepCheckoutProps) {
  const { personFees, machineCost, materialCost } = computeCheckoutCosts({
    persons: state.persons,
    usageType: state.usageType,
    items,
    config,
  })
  const nfcItems = useMemo(() => items.filter((i) => i.origin === "nfc"), [items])
  const materialItems = useMemo(
    () => items.filter((i) => i.origin !== "nfc"),
    [items],
  )
  const subtotal = personFees + machineCost + materialCost

  // Donation is split: manual entry + optional round-up top-up to a chosen
  // target. The underlying CheckoutState field is still named `tip` (kept
  // for back-compat with already-issued bills and the persisted
  // `checkout.summary.tip` shape); the UI and local variables call it
  // "Spende" / donation because that's what it actually is. See issue
  // #250 + ADR-equivalent decision: option A — single donation field, no
  // tip semantics.
  const [manualDonation, setManualDonation] = useState(0)
  const [roundUpEnabled, setRoundUpEnabled] = useState(false)
  const [roundUpTarget, setRoundUpTarget] = useState<number | null>(null)

  const roundBase = subtotal + manualDonation
  const roundOpts = useMemo(() => roundUpOptions(roundBase), [roundBase])

  // Auto-pick the smallest target when options first appear / the chosen
  // target is no longer offered (e.g. base just crossed a threshold).
  const activeTarget = roundUpTarget && roundOpts.includes(roundUpTarget)
    ? roundUpTarget
    : (roundOpts[0] ?? null)

  const effectiveRoundUp =
    roundUpEnabled && activeTarget != null
      ? Math.max(0, +(activeTarget - roundBase).toFixed(2))
      : 0
  const donationTotal = manualDonation + effectiveRoundUp
  const total = subtotal + donationTotal

  const syncDonation = useCallback(
    (manual: number, enabled: boolean, target: number | null) => {
      const base = subtotal + manual
      const round = enabled && target != null
        ? Math.max(0, +(target - base).toFixed(2))
        : 0
      dispatch({ type: "SET_TIP", amount: manual + round })
    },
    [subtotal, dispatch],
  )

  const handleManualDonationChange = (value: number) => {
    setManualDonation(value)
    syncDonation(value, roundUpEnabled, activeTarget)
  }
  const handleRoundUpToggle = (enabled: boolean) => {
    setRoundUpEnabled(enabled)
    syncDonation(manualDonation, enabled, activeTarget)
  }
  const handleRoundUpTarget = (target: number) => {
    setRoundUpTarget(target)
    // Picking a target also turns the round-up on — matches the user
    // intent of "I just chose this" without an extra checkbox click.
    setRoundUpEnabled(true)
    syncDonation(manualDonation, true, target)
  }

  // Keep the dispatched donation honest when the offered round-up set
  // changes out from under the user — e.g. switching usageType to
  // "intern" zeroes the billed subtotal, so the previously-selected
  // 0.60 CHF round-up would otherwise linger in global state (issue
  // #236). The render path already shows the correct value via
  // `effectiveRoundUp`; this effect keeps the dispatched value in sync.
  //
  // Disable round-up entirely when no options remain (per Mike's "or
  // uncheck it"); re-pick the auto target when the previously-chosen one
  // dropped out of the offered set. The manual donation portion is
  // preserved — that was entered intentionally and should not be reset.
  const dispatchedDonation = state.tip
  useEffect(() => {
    if (roundOpts.length === 0) {
      if (roundUpEnabled) setRoundUpEnabled(false)
      // Drop any lingering round-up from the dispatched donation without
      // disturbing the manual portion.
      if (dispatchedDonation !== manualDonation) {
        dispatch({ type: "SET_TIP", amount: manualDonation })
      }
      return
    }
    if (!roundUpEnabled) return
    // Options exist + round-up enabled: ensure the dispatched amount
    // matches the currently-displayed donation (manualDonation +
    // effectiveRoundUp recomputed against the new base/target).
    const expected = +(manualDonation + effectiveRoundUp).toFixed(2)
    if (Math.abs(dispatchedDonation - expected) > 0.001) {
      dispatch({ type: "SET_TIP", amount: expected })
    }
  }, [
    roundOpts,
    roundUpEnabled,
    manualDonation,
    effectiveRoundUp,
    dispatchedDonation,
    dispatch,
  ])

  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const totalMachineMinutes = nfcItems.reduce(
    (m, i) => m + Math.round(i.quantity * 60),
    0,
  )

  return (
    <div className="flex flex-col flex-1 gap-6">
      {submitError && (
        <div
          role="alert"
          data-testid="checkout-submit-error"
          className="rounded-md border border-destructive/50 bg-destructive/5 text-destructive p-4 text-sm"
        >
          {submitError}
        </div>
      )}

      {/* Block — Dein Besuch */}
      <SectionEyebrow>Dein Besuch</SectionEyebrow>

      {/* Three type-of-cost rows in one bordered card */}
      <div className="rounded-md border border-border bg-background overflow-hidden">
        <ExpandableSection
          id="nutzung"
          icon={<Coins className="h-4 w-4 text-cog-teal-dark" />}
          title="Nutzungsgebühren"
          summary={`${state.persons.length} ${
            state.persons.length === 1 ? "Person" : "Personen"
          } · ${USAGE_TYPE_LABELS[state.usageType]}`}
          amount={personFees}
          open={openSections.has("nutzung")}
          onToggle={() => toggle("nutzung")}
        >
          <Label
            htmlFor="usage-type"
            className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Nutzungsart
          </Label>
          <select
            id="usage-type"
            value={state.usageType}
            onChange={(e) =>
              dispatch({
                type: "SET_USAGE_TYPE",
                usageType: e.target.value as UsageType,
              })
            }
            className="mt-1.5 mb-4 h-10 w-full max-w-xs rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-cog-teal focus:ring-2 focus:ring-cog-teal/30"
          >
            {Object.entries(USAGE_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <DetailLabel>Personen</DetailLabel>
          <ul className="flex flex-col mt-1">
            {state.persons.map((p) => {
              // Internal usage is never billed — display 0 per person to
              // match `computeCheckoutCosts` and the server.
              const fee =
                state.usageType === "intern"
                  ? 0
                  : calculateFee(p.userType, state.usageType, config) ?? 0
              return (
                <li
                  key={p.id}
                  className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 py-1.5 text-sm border-b border-dotted border-border last:border-b-0"
                >
                  <span className="font-medium text-foreground truncate">
                    {p.firstName} {p.lastName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {USER_TYPE_LABELS[p.userType]}
                  </span>
                  <span className="font-medium tabular-nums text-right min-w-[70px]">
                    {formatCHF(fee)}
                  </span>
                </li>
              )
            })}
          </ul>
        </ExpandableSection>

        <ExpandableSection
          id="maschinen"
          icon={<Wrench className="h-4 w-4 text-cog-teal-dark" />}
          title="Maschinen-/Werkzeugnutzung"
          summary={
            nfcItems.length === 0
              ? "Keine Maschinennutzung"
              : `${nfcItems.length} ${
                  nfcItems.length === 1 ? "Maschine" : "Maschinen"
                } · ${totalMachineMinutes} Min total`
          }
          amount={machineCost}
          open={openSections.has("maschinen")}
          onToggle={() => toggle("maschinen")}
        >
          {nfcItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Maschinen oder Werkzeuge erfasst.
            </p>
          ) : (
            <PositionTable
              firstColLabel="Akkumulierte Nutzungszeit"
              rows={nfcItems.map((item) => ({
                key: item.id,
                title: item.description,
                subtitle: null,
                menge: `${Math.round(item.quantity * 60)} Min`,
                kosten: `${item.unitPrice.toFixed(2)}/h`,
                preis: item.totalPrice.toFixed(2),
              }))}
            />
          )}
        </ExpandableSection>

        <ExpandableSection
          id="material"
          icon={<Package className="h-4 w-4 text-cog-teal-dark" />}
          title="Materialbezug"
          summary={
            materialItems.length === 0
              ? "Kein Material bezogen"
              : `${materialItems.length} ${
                  materialItems.length === 1 ? "Position" : "Positionen"
                }`
          }
          amount={materialCost}
          open={openSections.has("material")}
          onToggle={() => toggle("material")}
        >
          {materialItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Kein Material bezogen.
            </p>
          ) : (
            <PositionTable
              firstColLabel="Bezogenes Material"
              rows={materialItems.map(rowFromItem)}
            />
          )}
        </ExpandableSection>
      </div>

      {/* Spende — gold card, sits below items */}
      <SpendeCard
        spende={manualDonation}
        onSpendeChange={handleManualDonationChange}
        roundUpEnabled={roundUpEnabled}
        roundUpOptions={roundOpts}
        roundUpTarget={activeTarget}
        roundUpDelta={effectiveRoundUp}
        onRoundUpToggle={handleRoundUpToggle}
        onRoundUpTarget={handleRoundUpTarget}
      />

      {/* Total — gold-swash highlight under amount */}
      <div className="flex items-baseline justify-between pt-5 border-t-2 border-foreground">
        <span className="font-heading font-bold text-2xl">Total</span>
        <div className="text-right">
          <span className="relative inline-block font-heading font-bold text-3xl tabular-nums">
            <span
              aria-hidden
              className="absolute left-[-4px] right-[-4px] bottom-[5px] h-[11px] bg-oww-gold opacity-70 -rotate-1 -z-10"
            />
            {formatCHF(total)}
          </span>
          <span className="block text-xs text-muted-foreground mt-1">
            keine MWST.
          </span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Sticky bottom navigation */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex gap-3 justify-between">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          onClick={() => dispatch({ type: "SET_STEP", step: 1 })}
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-50"
          onClick={onSubmit}
          disabled={submitting || total < 0}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Weiter zum Bezahlen
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] font-heading font-bold uppercase tracking-[0.08em] text-cog-teal-dark">
      {children}
    </div>
  )
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  )
}

interface ExpandableSectionProps {
  id: string
  icon: React.ReactNode
  title: string
  summary: string
  amount: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

function ExpandableSection({
  id,
  icon,
  title,
  summary,
  amount,
  open,
  onToggle,
  children,
}: ExpandableSectionProps) {
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-detail`}
        onClick={onToggle}
        className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 text-left border-b border-border/60 last:border-b-0 hover:bg-muted/30 transition-colors data-[open=true]:bg-transparent"
        data-open={open}
      >
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center text-muted-foreground transition-transform",
            open && "rotate-90 text-cog-teal-dark",
          )}
        >
          <ChevronRight className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <div className="flex items-center gap-2 min-w-0 font-heading font-bold text-[15px] text-foreground leading-tight">
            <span className="flex-shrink-0">{icon}</span>
            <span className="min-w-0 break-words">{title}</span>
          </div>
          <span className="block mt-1 text-[13px] text-muted-foreground truncate">
            {summary}
          </span>
        </span>
        <span className="font-semibold text-[15px] tabular-nums text-right min-w-[90px]">
          {formatCHF(amount)}
        </span>
      </button>
      {/* CSS-only expand animation: grid-rows transitions between 0fr and 1fr,
          while the inner cell uses min-h-0 + overflow-hidden so the natural
          content height drives the animated extent. */}
      <div
        id={`${id}-detail`}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out border-border/60 last:border-b-0",
          open
            ? "grid-rows-[1fr] opacity-100 border-b"
            : "grid-rows-[0fr] opacity-0 border-b-0",
        )}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-5 sm:px-6 pl-12 sm:pl-14 pr-5 sm:pr-6 pt-4 pb-5 bg-muted/30">
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

interface SpendeCardProps {
  spende: number
  onSpendeChange: (v: number) => void
  roundUpEnabled: boolean
  /** Available round-up targets in ascending order. The first entry is
   *  the "natural next step" (next franc / 0.50). */
  roundUpOptions: number[]
  /** Currently selected target, or null when no options are available. */
  roundUpTarget: number | null
  roundUpDelta: number
  onRoundUpToggle: (enabled: boolean) => void
  onRoundUpTarget: (target: number) => void
}

/** Permissive numeric pattern accepted while typing: digits with at most one
 *  `.` or `,` separator. Empty string is also accepted so the field can be
 *  fully cleared. */
const SPENDE_TYPING_PATTERN = /^(?:|\d*(?:[.,]\d*)?)$/

export function SpendeCard({
  spende,
  onSpendeChange,
  roundUpEnabled,
  roundUpOptions: roundOpts,
  roundUpTarget,
  roundUpDelta,
  onRoundUpToggle,
  onRoundUpTarget,
}: SpendeCardProps) {
  // Raw text the user is typing. Decoupled from `spende` so a keystroke like
  // "20" survives the parse-and-reformat round-trip that previously stripped
  // trailing zeros.
  const [text, setText] = useState(() => (spende > 0 ? spende.toFixed(2) : ""))
  const focusedRef = useRef(false)

  // Sync from external `spende` only while the field is unfocused. This keeps
  // the displayed text canonical when the parent updates `spende` (rare today
  // but cheap to be safe), without clobbering mid-typing input.
  useEffect(() => {
    if (focusedRef.current) return
    const canonical = spende > 0 ? spende.toFixed(2) : ""
    // Avoid spurious updates when the existing text already parses to the
    // same value (e.g. "20" vs "20.00" while focused-then-blurred elsewhere).
    const parsed = parseFloat(text.replace(",", ".")) || 0
    if (parsed !== spende) setText(canonical)
  }, [spende, text])

  return (
    <div className="rounded-md border border-oww-gold-border bg-oww-gold-light p-5 sm:p-6 grid sm:grid-cols-[1fr_auto] gap-4 sm:gap-6 items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-heading font-bold text-base text-oww-gold-text">
          <Heart className="h-4 w-4 text-oww-gold-dark" />
          Spende
        </div>
        <p className="mt-1 text-[14px] leading-relaxed text-oww-gold-text">
          Hast du bei uns einen tollen Tag erlebt, dir wurde von unseren
          erfahrenen Vereinsmitgliedern geholfen oder am Fachabend konntest du
          von unseren Profis profitieren? Dann freuen wir uns über einen
          Zustupf.
        </p>
      </div>
      <div className="self-center justify-self-end">
        <div className="relative inline-flex items-center">
          <span className="absolute left-3.5 text-xs font-medium text-oww-gold-text-muted pointer-events-none">
            CHF
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={text}
            onFocus={() => {
              focusedRef.current = true
            }}
            onChange={(e) => {
              const raw = e.target.value
              if (!SPENDE_TYPING_PATTERN.test(raw)) return
              setText(raw)
              const v = parseFloat(raw.replace(",", ".")) || 0
              onSpendeChange(v)
            }}
            onBlur={() => {
              focusedRef.current = false
              const v = parseFloat(text.replace(",", ".")) || 0
              setText(v > 0 ? v.toFixed(2) : "")
              if (v !== spende) onSpendeChange(v)
            }}
            aria-label="Spende"
            className="w-[140px] h-11 pl-12 pr-3.5 rounded-md border border-oww-gold-border bg-background text-base font-semibold tabular-nums text-oww-gold-text text-right placeholder:text-oww-gold-border placeholder:font-normal focus:outline-none focus:border-oww-gold-dark focus:ring-2 focus:ring-oww-gold-dark/20"
          />
        </div>
      </div>

      {roundOpts.length > 0 && roundUpTarget != null && (
        <div className="sm:col-span-2 pt-3.5 border-t border-dashed border-oww-gold-border/70 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-oww-gold-text">
          {/* Checkbox + its own label own the toggle; the select is a
              sibling so clicking it doesn't bubble up and toggle the
              checkbox. */}
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={roundUpEnabled}
              onChange={(e) => onRoundUpToggle(e.target.checked)}
              className="h-4 w-4 accent-oww-gold-dark cursor-pointer"
              aria-label="Aufrunden"
            />
            <span>Auf</span>
          </label>
          <select
            value={String(roundUpTarget)}
            onChange={(e) => onRoundUpTarget(parseFloat(e.target.value))}
            aria-label="Aufrunden-Ziel"
            className="appearance-none bg-transparent border-0 border-b border-dashed border-oww-gold-dark/70 text-oww-gold-text font-semibold pr-5 pl-1 py-0.5 cursor-pointer focus:outline-none focus:border-oww-gold-dark"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23a07c00' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 2px center",
            }}
          >
            {roundOpts.map((target, i) => (
              <option key={target} value={String(target)}>
                {roundUpOptionLabel(target, i === 0)}
              </option>
            ))}
          </select>
          <span>aufrunden</span>
          {roundUpEnabled && roundUpDelta > 0 && (
            <span className="ml-auto text-xs font-medium tabular-nums text-oww-gold-text-muted">
              + {formatCHF(roundUpDelta)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

