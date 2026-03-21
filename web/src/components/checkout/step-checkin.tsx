// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { PersonCard } from "./person-card"
import { Plus, ArrowRight } from "lucide-react"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import { validatePerson } from "./validation"

interface StepCheckinProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  isAnonymous: boolean
}

export function StepCheckin({ state, dispatch, isAnonymous }: StepCheckinProps) {
  // touched: personId → field → true
  const [touched, setTouched] = useState<Record<string, Record<string, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)

  const handleBlur = useCallback((personId: string, field: string) => {
    setTouched((prev) => ({
      ...prev,
      [personId]: { ...prev[personId], [field]: true },
    }))
  }, [])

  const allErrors = useMemo(
    () =>
      Object.fromEntries(
        state.persons.map((p) => [p.id, validatePerson(p, isAnonymous)]),
      ),
    [state.persons, isAnonymous],
  )

  const allValid = useMemo(
    () => state.persons.every((p) => Object.keys(allErrors[p.id] ?? {}).length === 0),
    [state.persons, allErrors],
  )

  const termsError = useMemo(() => {
    if (!isAnonymous) return null
    const person = state.persons.find((p) => !p.isPreFilled && allErrors[p.id]?.termsAccepted)
    return person ? allErrors[person.id].termsAccepted : null
  }, [state.persons, allErrors, isAnonymous])

  const handleWeiter = () => {
    setSubmitted(true)
    if (allValid) {
      dispatch({ type: "SET_STEP", step: 1 })
    }
  }

  const handleAddPerson = () => {
    setSubmitted(false)
    dispatch({ type: "ADD_PERSON" })
  }

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
          errors={allErrors[person.id]}
          touched={touched[person.id]}
          submitted={submitted}
          onBlur={(field) => handleBlur(person.id, field)}
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
          <div
            className={
              submitted && termsError
                ? "bg-[#fce4e4] p-3 rounded-sm space-y-2"
                : "space-y-2"
            }
          >
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
            {submitted && termsError && (
              <span className="inline-block px-2 py-0.5 text-xs text-white bg-[#cc2a24] rounded-sm">
                {termsError}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          onClick={handleAddPerson}
        >
          <Plus className="h-4 w-4" />
          Person hinzufügen
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-white bg-cog-teal rounded-[3px] hover:bg-cog-teal-dark transition-colors"
          onClick={handleWeiter}
        >
          Weiter
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
