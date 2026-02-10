// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { Button } from "@/components/ui/button"
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
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Check In</h2>
      <p className="text-sm text-muted-foreground">
        {isAnonymous
          ? "Bitte trage deine Daten ein."
          : "Bestätige deine Angaben und wähle die Nutzungsart."}
      </p>

      {state.persons.map((person, i) => (
        <PersonCard
          key={person.id}
          person={person}
          index={i}
          isOnly={state.persons.length === 1}
          showTerms={isAnonymous}
          dispatch={dispatch}
        />
      ))}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => dispatch({ type: "ADD_PERSON" })}
      >
        <Plus className="h-4 w-4 mr-2" />
        Person hinzufügen
      </Button>

      <Button
        className="w-full"
        onClick={() => dispatch({ type: "SET_STEP", step: 1 })}
        disabled={!allValid}
      >
        Weiter
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  )
}
