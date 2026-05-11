// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useReducer } from "react"
import {
  type UserType,
  type UsageType,
} from "@modules/lib/pricing"

export interface CheckoutPerson {
  id: string
  firstName: string
  lastName: string
  email: string
  userType: UserType
  termsAccepted: boolean
  isPreFilled: boolean
  /**
   * Set when the person was added from the signed-in user's family roster
   * (issue #209). Lets the wizard dedupe quick-add candidates against the
   * current cards and lets the submit payload attribute the visit to a
   * real account (incl. child accounts with `email: null`).
   */
  userId?: string | null
  billingCompany?: string
  billingStreet?: string
  billingZip?: string
  billingCity?: string
}

export type PaymentMethod = "rechnung" | "monthly" | "twint"

export interface CheckoutState {
  step: number // 0 = check-in, 1 = costs, 2 = check-out, 3 = bezahlen
  persons: CheckoutPerson[]
  usageType: UsageType
  tip: number
  submitted: boolean
  checkoutId: string | null
  totalPrice: number
}

type CheckoutAction =
  | { type: "SET_STEP"; step: number }
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
  | { type: "SET_USAGE_TYPE"; usageType: UsageType }
  | { type: "SET_TIP"; amount: number }
  | { type: "SET_SUBMITTED"; checkoutId: string | null; totalPrice: number }
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

const initialState: CheckoutState = {
  step: 0,
  persons: [createEmptyPerson()],
  usageType: "regular",
  tip: 0,
  submitted: false,
  checkoutId: null,
  totalPrice: 0,
}

function checkoutReducer(
  state: CheckoutState,
  action: CheckoutAction
): CheckoutState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step }

    case "ADD_PERSON":
      return { ...state, persons: [...state.persons, createEmptyPerson()] }

    case "ADD_FAMILY_PERSON":
      // Append a fully-populated, pre-filled card pulled from the
      // signed-in user's family roster (issue #209). Pre-filled cards
      // skip validation, so child accounts (email: null → "") work
      // without per-card edits.
      return {
        ...state,
        persons: [
          ...state.persons,
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
        ],
      }

    case "REMOVE_PERSON":
      return {
        ...state,
        persons: state.persons.filter((p) => p.id !== action.id),
      }

    case "UPDATE_PERSON":
      return {
        ...state,
        persons: state.persons.map((p) => {
          if (p.id !== action.id) return p
          return { ...p, ...action.updates }
        }),
      }

    case "SET_USAGE_TYPE":
      return { ...state, usageType: action.usageType }

    case "SET_TIP":
      return { ...state, tip: Math.max(0, action.amount) }

    case "SET_SUBMITTED":
      // Advance to step 3 (Bezahlen) so the wizard renders PaymentResult.
      return {
        ...state,
        step: 3,
        submitted: true,
        checkoutId: action.checkoutId,
        totalPrice: action.totalPrice,
      }

    case "RESET":
      return initialState

    default:
      return state
  }
}

export { checkoutReducer, initialState }

export function useCheckoutState(initialStep?: number) {
  const [state, dispatch] = useReducer(
    checkoutReducer,
    initialStep != null && initialStep > 0
      ? { ...initialState, step: initialStep }
      : initialState,
  )
  return { state, dispatch }
}

export type { CheckoutAction }
