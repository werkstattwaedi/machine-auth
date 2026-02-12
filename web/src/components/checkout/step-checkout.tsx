// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import { formatCHF } from "@/lib/format"
import { USER_TYPE_LABELS } from "@/lib/pricing"
import { ArrowLeft, Loader2 } from "lucide-react"
import type { CheckoutState, CheckoutAction, LocalMaterialItem } from "./use-checkout-state"

interface StepCheckoutProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  onSubmit: () => Promise<void>
  submitting: boolean
  localMaterialUsage: LocalMaterialItem[]
}

export function StepCheckout({
  state,
  dispatch,
  onSubmit,
  submitting,
  localMaterialUsage,
}: StepCheckoutProps) {
  const personFees = state.persons.reduce((sum, p) => sum + p.fee, 0)

  // Combine Firestore-synced and local items into a unified display list
  const localAsDisplay = localMaterialUsage.map((l) => ({
    id: l.id,
    description: l.description,
    workshop: l.workshop,
    totalPrice: l.details.totalPrice ?? 0,
    category: l.details.category ?? "",
    quantity: l.details.quantity ?? 0,
    type: l.type,
  }))
  const allItems = [...state.materialUsage, ...localAsDisplay]

  // Split into machine hours and material/service
  const machineHoursItems = allItems.filter((u) => u.type === "machine_hours")
  const materialItems = allItems.filter((u) => u.type !== "machine_hours")
  const machineHoursTotal = machineHoursItems.reduce((sum, u) => sum + u.totalPrice, 0)
  const materialTotal = materialItems.reduce((sum, u) => sum + u.totalPrice, 0)
  const allMaterialTotal = allItems.reduce((sum, u) => sum + u.totalPrice, 0)

  const total = personFees + allMaterialTotal + state.tip

  return (
    <div className="space-y-6">
      <h4 className="text-sm font-semibold text-muted-foreground">
        Zusammenfassung
      </h4>

      <div>
        <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4 mb-4"
>
          Nutzungsgebühren
        </h2>
        <div className="space-y-3">
          {state.persons.map((p) => (
            <div key={p.id} className="flex items-center gap-6 text-sm">
              <span className="w-40">
                {p.firstName} {p.lastName}
              </span>
              <span className="w-40">{p.email}</span>
              <span className="w-28">{USER_TYPE_LABELS[p.userType]}</span>
              <span>{formatCHF(p.fee)}</span>
            </div>
          ))}
        </div>
        <div className="text-right font-bold text-lg mt-2">
          {formatCHF(personFees)}
        </div>
      </div>

      {machineHoursTotal > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4 mb-4"
    >
              Maschinenkosten
            </h2>
            {machineHoursItems.map((u) => (
              <div key={u.id} className="flex justify-between text-sm">
                <span>{u.description} ({u.workshop})</span>
                <span className="font-semibold">{formatCHF(u.totalPrice)}</span>
              </div>
            ))}
            <div className="text-right font-bold text-lg mt-2">
              {formatCHF(machineHoursTotal)}
            </div>
          </div>
        </>
      )}

      {materialTotal > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4 mb-4"
    >
              Materialkosten
            </h2>
            {materialItems.map((u) => (
              <div key={u.id} className="flex justify-between text-sm">
                <span>{u.description} ({u.workshop})</span>
                <span className="font-semibold">{formatCHF(u.totalPrice)}</span>
              </div>
            ))}
            <div className="text-right font-bold text-lg mt-2">
              {formatCHF(materialTotal)}
            </div>
          </div>
        </>
      )}

      <Separator />

      <div>
        <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4 mb-4"
>
          Trinkgeld/Spenden
        </h2>
        <div className="space-y-2">
          <Label className="text-sm font-bold">Betrag (CHF)</Label>
          <input
            type="number"
            step="0.50"
            min="0"
            value={state.tip || ""}
            onChange={(e) =>
              dispatch({
                type: "SET_TIP",
                amount: parseFloat(e.target.value) || 0,
              })
            }
            placeholder="0.00"
            className="flex h-9 w-full max-w-xs rounded-none border border-[#ccc] bg-background px-3 py-1 text-sm outline-none focus:border-cog-teal"
          />
          <p className="text-sm text-muted-foreground">
            Hast du bei uns einen tollen Tag erlebt, dir wurde von unseren
            erfahrenen Vereinsmitgliedern geholfen oder am Fachabend konntest du
            von unseren Profis profitieren? Dann freuen wir uns über einen
            Zustupf.
          </p>
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold font-body">
          Total
        </h2>
        <h2 className="text-xl font-bold font-body underline decoration-cog-teal decoration-2 underline-offset-4"
>
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
