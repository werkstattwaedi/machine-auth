// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useReducer } from "react"
import {
  type UserType,
  type UsageType,
} from "@modules/lib/pricing"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"

export interface CheckoutPerson {
  id: string
  firstName: string
  lastName: string
  email: string
  userType: UserType
  termsAccepted: boolean
  isPreFilled: boolean
  billingCompany?: string
  billingStreet?: string
  billingZip?: string
  billingCity?: string
}

export interface CheckoutState {
  step: number // 0 = check-in, 1 = costs, 2 = checkout
  persons: CheckoutPerson[]
  usageType: UsageType
  tip: number
  submitted: boolean
  checkoutId: string | null
  totalPrice: number
  localItems: CheckoutItemLocal[] // For anonymous users (no Firestore persistence)
}

type CheckoutAction =
  | { type: "SET_STEP"; step: number }
  | { type: "ADD_PERSON" }
  | { type: "REMOVE_PERSON"; id: string }
  | { type: "UPDATE_PERSON"; id: string; updates: Partial<CheckoutPerson> }
  | { type: "SET_USAGE_TYPE"; usageType: UsageType }
  | { type: "SET_TIP"; amount: number }
  | { type: "SET_SUBMITTED"; checkoutId: string | null; totalPrice: number }
  | { type: "RESET" }
  | { type: "ADD_LOCAL_ITEM"; item: CheckoutItemLocal }
  | { type: "UPDATE_LOCAL_ITEM"; id: string; item: CheckoutItemLocal }
  | { type: "REMOVE_LOCAL_ITEM"; id: string }

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
  localItems: [],
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
      return {
        ...state,
        submitted: true,
        checkoutId: action.checkoutId,
        totalPrice: action.totalPrice,
      }

    case "RESET":
      return initialState

    case "ADD_LOCAL_ITEM":
      return { ...state, localItems: [...state.localItems, action.item] }

    case "UPDATE_LOCAL_ITEM":
      return {
        ...state,
        localItems: state.localItems.map((i) =>
          i.id === action.id ? action.item : i,
        ),
      }

    case "REMOVE_LOCAL_ITEM":
      return {
        ...state,
        localItems: state.localItems.filter((i) => i.id !== action.id),
      }

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
