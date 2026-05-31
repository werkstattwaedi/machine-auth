// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useReducer } from "react"
import { type UserType } from "@modules/lib/pricing"

/**
 * Reducer for the wizard's person roster (issue #209/#246). The step
 * counter and other transient wizard state (tip, usageType, submission
 * status) now live in the URL or in `WizardProvider` local state — only
 * the persons array still needs a reducer, since it's edited from
 * multiple places (PersonCard fields, family-quick-add chips, rehydrate
 * from open Firestore checkout).
 */
export interface CheckoutPerson {
  id: string
  firstName: string
  lastName: string
  email: string
  userType: UserType
  termsAccepted: boolean
  isPreFilled: boolean
  userId?: string | null
  billingCompany?: string
  billingStreet?: string
  billingZip?: string
  billingCity?: string
}

export type PaymentMethod = "rechnung" | "monthly" | "twint"

export type PersonsAction =
  | { type: "ADD_PERSON" }
  | {
      type: "ADD_FAMILY_PERSON"
      person: {
        userId: string
        firstName: string
        lastName: string
        email: string
        userType: UserType
      }
    }
  | { type: "REMOVE_PERSON"; id: string }
  | { type: "UPDATE_PERSON"; id: string; updates: Partial<CheckoutPerson> }
  | { type: "REPLACE_PERSONS"; persons: CheckoutPerson[] }
  | { type: "RESET" }

function createEmptyPerson(): CheckoutPerson {
  return {
    id: crypto.randomUUID(),
    firstName: "",
    lastName: "",
    email: "",
    userType: "erwachsen",
    termsAccepted: false,
    isPreFilled: false,
  }
}

const initialPersons: CheckoutPerson[] = [createEmptyPerson()]

function personsReducer(
  state: CheckoutPerson[],
  action: PersonsAction,
): CheckoutPerson[] {
  switch (action.type) {
    case "ADD_PERSON":
      return [...state, createEmptyPerson()]

    case "ADD_FAMILY_PERSON":
      return [
        ...state,
        {
          id: crypto.randomUUID(),
          firstName: action.person.firstName,
          lastName: action.person.lastName,
          email: action.person.email,
          userType: action.person.userType,
          termsAccepted: true,
          isPreFilled: true,
          userId: action.person.userId,
        },
      ]

    case "REMOVE_PERSON":
      return state.filter((p) => p.id !== action.id)

    case "UPDATE_PERSON":
      return state.map((p) => (p.id !== action.id ? p : { ...p, ...action.updates }))

    case "REPLACE_PERSONS":
      return action.persons

    case "RESET":
      return [createEmptyPerson()]

    default:
      return state
  }
}

export function usePersonsState() {
  const [persons, dispatch] = useReducer(personsReducer, initialPersons)
  return { persons, dispatch }
}

export { personsReducer, initialPersons }
