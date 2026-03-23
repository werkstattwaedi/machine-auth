// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback } from "react"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import { USER_TYPE_LABELS, USAGE_TYPE_LABELS, calculateFee } from "@/lib/pricing"
import type { PricingConfig, WorkshopId } from "@/lib/workshop-config"
import { ArrowLeft, Loader2, X } from "lucide-react"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import { SELECT_CLS } from "@/components/usage/inline-rows"
import type { UsageType } from "@/lib/pricing"

/** Compute up to 3 sensible round-up total targets based on current total.
 *  Small amounts (<20): include 0.50 steps. Larger amounts: integers/5/10 only. */
export function roundUpOptions(base: number): number[] {
  if (base <= 0) return []
  const maxTotal = base < 10 ? base + 3 : base * 1.1
  const bump = base + 0.01

  const candidates = new Set<number>()
  if (base < 10) {
    candidates.add(Math.ceil(bump * 2) / 2) // next 0.50
  }
  candidates.add(Math.ceil(bump))            // next integer
  candidates.add(Math.ceil(bump / 2) * 2)    // next even integer
  candidates.add(Math.ceil(bump / 5) * 5)    // next 5
  candidates.add(Math.ceil(bump / 10) * 10)  // next 10

  return Array.from(candidates)
    .sort((a, b) => a - b)
    .filter((t) => t > base && t <= maxTotal)
    .slice(0, 3)
}

/** Custom radio circle matching person-card styling */
function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center h-4 w-4 rounded-full border ${
        checked ? "border-cog-teal bg-cog-teal" : "border-[#ccc] bg-white"
      }`}
    >
      {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
    </span>
  )
}

interface StepCheckoutProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  onSubmit: () => Promise<void>
  submitting: boolean
  items: CheckoutItemLocal[]
  config: PricingConfig | null
}

export function StepCheckout({
  state,
  dispatch,
  onSubmit,
  submitting,
  items,
  config,
}: StepCheckoutProps) {
  // Entry fees from persons + usage type
  const personFees = state.persons.reduce(
    (sum, p) => sum + calculateFee(p.userType, state.usageType, config),
    0,
  )

  // Group all items by workshop
  const workshopGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: CheckoutItemLocal[] }>()
    for (const item of items) {
      const wsId = item.workshop
      if (!groups.has(wsId)) {
        const wsLabel = config?.workshops?.[wsId as WorkshopId]?.label ?? wsId
        groups.set(wsId, { label: wsLabel, items: [] })
      }
      groups.get(wsId)!.items.push(item)
    }
    return groups
  }, [items, config])

  const itemsCost = items.reduce((sum, i) => sum + i.totalPrice, 0)
  const subtotal = personFees + itemsCost

  // Tip is split: manual entry + optional round-up
  const [manualTip, setManualTip] = useState(0)
  const [roundUpTarget, setRoundUpTarget] = useState<number | null>(null)

  // Base for round-up = subtotal + manual tip
  const roundBase = subtotal + manualTip
  const roundOpts = useMemo(() => roundUpOptions(roundBase), [roundBase])

  // If selected round-up target is no longer valid, clear it
  const effectiveRoundUp = roundUpTarget && roundOpts.includes(roundUpTarget)
    ? Math.round((roundUpTarget - roundBase) * 100) / 100
    : 0
  const tipTotal = manualTip + effectiveRoundUp
  const total = subtotal + tipTotal

  const syncTip = useCallback((manual: number, roundTarget: number | null) => {
    const base = subtotal + manual
    const roundAmt = roundTarget ? Math.max(0, Math.round((roundTarget - base) * 100) / 100) : 0
    dispatch({ type: "SET_TIP", amount: manual + roundAmt })
  }, [subtotal, dispatch])

  const handleManualTipChange = (value: number) => {
    setManualTip(value)
    syncTip(value, roundUpTarget)
  }

  const handleRoundUpToggle = (target: number) => {
    const next = roundUpTarget === target ? null : target
    setRoundUpTarget(next)
    syncTip(manualTip, next)
  }

  return (
    <div className="space-y-6">
      <h4 className="text-sm font-semibold text-muted-foreground">
        Zusammenfassung
      </h4>

      {/* Usage fees (type selector + person list) */}
      <div>
        <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4 mb-4">
          Nutzungsgebühren
        </h2>
        <select
          value={state.usageType}
          onChange={(e) =>
            dispatch({
              type: "SET_USAGE_TYPE",
              usageType: e.target.value as UsageType,
            })
          }
          className={SELECT_CLS + " max-w-xs mb-4"}
        >
          {Object.entries(USAGE_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <div className="space-y-3">
          {state.persons.map((p) => {
            const fee = calculateFee(p.userType, state.usageType, config)
            return (
              <div key={p.id} className="flex items-center gap-6 text-sm">
                <span className="w-40">
                  {p.firstName} {p.lastName}
                </span>
                <span className="w-40">{p.email}</span>
                <span className="w-28">{USER_TYPE_LABELS[p.userType]}</span>
                <span>{formatCHF(fee)}</span>
              </div>
            )
          })}
        </div>
        <div className="text-right font-bold text-lg mt-2">
          {formatCHF(personFees)}
        </div>
      </div>

      {/* Workshop cost sections */}
      {Array.from(workshopGroups.entries()).map(([wsId, { label, items: wsItems }]) => {
        const wsTotal = wsItems.reduce((s, i) => s + i.totalPrice, 0)
        return (
          <div key={wsId}>
            <Separator />
            <div className="pt-6">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4">
                  {label}
                </h2>
                <span className="font-bold text-lg">{formatCHF(wsTotal)}</span>
              </div>
              {wsItems.map((item) => (
                <div key={item.id} className="flex justify-between text-sm mb-1">
                  <span>
                    {item.description}
                    {item.origin === "nfc" && (
                      <span className="text-muted-foreground ml-2">
                        {Math.round(item.quantity * 60)} min
                      </span>
                    )}
                  </span>
                  <span className="font-semibold">{formatCHF(item.totalPrice)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Subtotal before tips */}
      <Separator />
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground">Zwischentotal</span>
        <span className="font-bold text-lg">{formatCHF(subtotal)}</span>
      </div>

      <Separator />

      {/* Tip */}
      <div>
        <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4 mb-2">
          Trinkgeld/Spenden
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Hast du bei uns einen tollen Tag erlebt, dir wurde von unseren
          erfahrenen Vereinsmitgliedern geholfen oder am Fachabend konntest du
          von unseren Profis profitieren? Dann freuen wir uns über einen
          Zustupf.
        </p>

        {/* Manual tip entry */}
        <div className="space-y-2">
          <Label className="text-sm font-bold">Betrag (CHF)</Label>
          <input
            type="number"
            step="0.50"
            min="0"
            value={manualTip || ""}
            onChange={(e) => handleManualTipChange(parseFloat(e.target.value) || 0)}
            placeholder="0.00"
            className="h-9 w-full max-w-xs rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
        </div>

        {/* Round-up radio options */}
        {roundOpts.length > 0 && (
          <div className="flex items-center justify-between text-sm mt-3">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">Aufrunden auf</span>
              {roundOpts.map((target) => {
                const isActive = roundUpTarget === target
                return (
                  <label key={target} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="tip-round"
                      checked={isActive}
                      onChange={() => handleRoundUpToggle(target)}
                      className="sr-only"
                    />
                    <Radio checked={isActive} />
                    {formatCHF(target)}
                  </label>
                )
              })}
              {roundUpTarget && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => handleRoundUpToggle(roundUpTarget)}
                  aria-label="Aufrunden entfernen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <span className="font-semibold">
              {effectiveRoundUp > 0 ? formatCHF(effectiveRoundUp) : ""}
            </span>
          </div>
        )}

        {/* Tip subtotal */}
        {tipTotal > 0 && (
          <div className="text-right font-bold text-lg mt-2">
            {formatCHF(tipTotal)}
          </div>
        )}
      </div>

      <Separator />

      {/* Total */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold font-body">
          Total
        </h2>
        <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4">
          {formatCHF(total)}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground text-right">keine MWST.</p>

      <Separator />

      <div className="bg-[rgba(204,204,204,0.2)] p-[25px]">
        <h4 className="font-bold text-sm mb-1">Fair & sauber</h4>
        <p className="text-sm">
          Der Betrieb der Werkstatt basiert auf Vertrauen.
          <br />
          Vielen Dank dass du <strong>fair abrechnest</strong> und deinen{" "}
          <strong>Platz sauber</strong> hinterlässt.
        </p>
      </div>

      <div className="flex gap-3">
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
          Senden & zur Kasse
        </button>
      </div>
    </div>
  )
}
