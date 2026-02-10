// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Checkbox } from "@/components/ui/checkbox"
import { PersonCard } from "./person-card"
import { Plus, ArrowRight } from "lucide-react"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"

interface StepCheckinProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  isAnonymous: boolean
}

export function StepCheckin({ state, dispatch, isAnonymous }: StepCheckinProps) {
  const allValid = state.persons.every(
    (p) =>
      p.firstName.trim() &&
      p.lastName.trim() &&
      p.email.trim() &&
      (p.isPreFilled || !isAnonymous || p.termsAccepted)
  )

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold font-body">
        Deine Angaben
      </h2>

      {state.persons.map((person, i) => (
        <PersonCard
          key={person.id}
          person={person}
          index={i}
          isOnly={state.persons.length === 1}
          showTerms={false}
          dispatch={dispatch}
        />
      ))}

      {isAnonymous && (
        <div className="space-y-3 pt-2">
          <div className="flex items-start justify-between">
            <span className="text-sm font-bold">
              Nutzungsbestimmungen<span className="text-[#cc2a24]">*</span>
            </span>
            <a
              href="https://werkstattwaedi.ch/nutzungsbestimmungen"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline font-bold text-cog-teal"
            >
              Nutzungsbestimmungen lesen
            </a>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="terms-accept"
              checked={state.persons.every((p) => p.termsAccepted || p.isPreFilled)}
              onCheckedChange={(checked) => {
                state.persons.forEach((p) => {
                  if (!p.isPreFilled) {
                    dispatch({
                      type: "UPDATE_PERSON",
                      id: p.id,
                      updates: { termsAccepted: checked === true },
                    })
                  }
                })
              }}
            />
            <label htmlFor="terms-accept" className="text-sm leading-snug">
              Ich akzeptiere die Nutzungsbestimmungen
            </label>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          onClick={() => dispatch({ type: "ADD_PERSON" })}
        >
          <Plus className="h-4 w-4" />
          Person hinzufügen
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => dispatch({ type: "SET_STEP", step: 1 })}
          disabled={!allValid}
        >
          Weiter
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
