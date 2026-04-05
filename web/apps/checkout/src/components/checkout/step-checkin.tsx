// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useMemo, useCallback } from "react"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Button } from "@modules/components/ui/button"
import { PersonCard } from "./person-card"
import { Plus, ArrowRight, LogIn } from "lucide-react"
import type { CheckoutState, CheckoutAction } from "./use-checkout-state"
import { validatePerson } from "./validation"

interface StepCheckinProps {
  state: CheckoutState
  dispatch: React.Dispatch<CheckoutAction>
  isAnonymous: boolean
  kiosk: boolean
  isAccountLoggedIn: boolean
  onSignOut: () => void
}

export function StepCheckin({ state, dispatch, isAnonymous, kiosk, isAccountLoggedIn, onSignOut }: StepCheckinProps) {
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

      <IdentityHint
        kiosk={kiosk}
        isAccountLoggedIn={isAccountLoggedIn}
        isTagIdentified={!isAnonymous && !isAccountLoggedIn}
      />

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
          title={i === 0 && isAccountLoggedIn ? "" : undefined}
          onSignOut={i === 0 && isAccountLoggedIn ? onSignOut : undefined}
        />
      ))}

      <div className="flex flex-col items-start gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-cog-teal border border-cog-teal rounded-[3px] bg-white hover:bg-cog-teal-light transition-colors"
          onClick={handleAddPerson}
        >
          <Plus className="h-4 w-4" />
          Person hinzufügen
        </button>

        {isAnonymous && (
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
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
                  className="bg-white"
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
                <span className="block w-full px-2 py-0.5 text-xs text-white bg-[#cc2a24] rounded-sm">
                  {termsError}
                </span>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Sticky bottom navigation */}
      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background border-t border-border flex gap-3">
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

function IdentityHint({
  kiosk,
  isAccountLoggedIn,
  isTagIdentified,
}: {
  kiosk: boolean
  isAccountLoggedIn: boolean
  isTagIdentified: boolean
}) {
  // Already identified — no hint needed
  if (isTagIdentified || isAccountLoggedIn) return null

  // Kiosk — NFC hint
  if (kiosk) {
    return (
      <div className="flex items-center gap-3 rounded-[3px] border border-cog-teal/30 bg-cog-teal/5 px-4 py-2.5">
        <svg
          viewBox="0 0 64 64"
          className="h-8 w-8 shrink-0 text-cog-teal animate-pulse"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="10" y="14" width="44" height="36" rx="4" />
          <path d="M30 38a4 4 0 0 1 0-8" />
          <path d="M26 42a10 10 0 0 1 0-20" />
          <path d="M22 46a16 16 0 0 1 0-28" />
        </svg>
        <span className="text-sm text-muted-foreground">
          Badge an den Leser halten, um deine Daten zu laden
        </span>
      </div>
    )
  }

  // Browser — login hint
  return (
    <div className="flex items-center justify-between gap-3 rounded-[3px] border border-border bg-muted/50 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">
        Bereits registriert?
      </span>
      {/* Plain <a> instead of router <Link> — intentional full reload clears checkout state */}
      <a href="/login?redirect=/">
        <Button variant="ghost" size="sm" className="text-cog-teal hover:text-cog-teal-dark">
          <LogIn className="h-4 w-4 mr-1.5" />
          Anmelden
        </Button>
      </a>
    </div>
  )
}
