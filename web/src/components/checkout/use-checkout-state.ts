// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useReducer } from "react"
import {
  type UserType,
  type UsageType,
  calculateFee,
} from "@/lib/pricing"
import type { LocalMaterialItem } from "@/components/usage/inline-rows"

export type { LocalMaterialItem }

export interface CheckoutPerson {
  id: string
  firstName: string
  lastName: string
  email: string
  userType: UserType
  usageType: UsageType
  fee: number
  termsAccepted: boolean
  isPreFilled: boolean
  billingCompany?: string
  billingStreet?: string
  billingZip?: string
  billingCity?: string
}

export interface UsageMachineItem {
  id: string
  machineId: string
  machineName: string
  workshop: string
  checkIn: Date
  checkOut: Date | null
}

export interface UsageMaterialItem {
  id: string
  description: string
  workshop: string
  totalPrice: number
  category: string
  quantity: number
  type?: "material" | "machine_hours" | "service"
}

export interface CheckoutState {
  step: number // 0 = check-in, 1 = costs, 2 = checkout
  persons: CheckoutPerson[]
  machineUsage: UsageMachineItem[]
  materialUsage: UsageMaterialItem[]
  localMaterialUsage: LocalMaterialItem[]
  tip: number
  submitted: boolean
  checkoutId: string | null
  totalPrice: number
}

type CheckoutAction =
  | { type: "SET_STEP"; step: number }
  | { type: "ADD_PERSON" }
  | { type: "REMOVE_PERSON"; id: string }
  | { type: "UPDATE_PERSON"; id: string; updates: Partial<CheckoutPerson> }
  | { type: "SET_MACHINE_USAGE"; items: UsageMachineItem[] }
  | { type: "SET_MATERIAL_USAGE"; items: UsageMaterialItem[] }
  | { type: "ADD_LOCAL_MATERIAL"; item: LocalMaterialItem }
  | { type: "UPDATE_LOCAL_MATERIAL"; id: string; item: LocalMaterialItem }
  | { type: "REMOVE_LOCAL_MATERIAL"; id: string }
  | { type: "SET_TIP"; amount: number }
  | { type: "SET_SUBMITTED"; checkoutId: string; totalPrice: number }
  | { type: "RESET" }

function createEmptyPerson(): CheckoutPerson {
  return {
    id: crypto.randomUUID(),
    firstName: "",
    lastName: "",
    email: "",
    userType: "erwachsen",
    usageType: "regular",
    fee: calculateFee("erwachsen", "regular"),
    termsAccepted: false,
    isPreFilled: false,
  }
}

function recalcFee(person: CheckoutPerson): CheckoutPerson {
  return {
    ...person,
    fee: calculateFee(person.userType, person.usageType),
  }
}

const initialState: CheckoutState = {
  step: 0,
  persons: [createEmptyPerson()],
  machineUsage: [],
  materialUsage: [],
  localMaterialUsage: [],
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
          const updated = { ...p, ...action.updates }
          // Recalculate fee if userType or usageType changed
          if (
            action.updates.userType !== undefined ||
            action.updates.usageType !== undefined
          ) {
            return recalcFee(updated)
          }
          return updated
        }),
      }

    case "SET_MACHINE_USAGE":
      return { ...state, machineUsage: action.items }

    case "SET_MATERIAL_USAGE":
      return { ...state, materialUsage: action.items }

    case "ADD_LOCAL_MATERIAL":
      return {
        ...state,
        localMaterialUsage: [...state.localMaterialUsage, action.item],
      }

    case "UPDATE_LOCAL_MATERIAL":
      return {
        ...state,
        localMaterialUsage: state.localMaterialUsage.map((i) =>
          i.id === action.id ? action.item : i,
        ),
      }

    case "REMOVE_LOCAL_MATERIAL":
      return {
        ...state,
        localMaterialUsage: state.localMaterialUsage.filter(
          (i) => i.id !== action.id,
        ),
      }

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

    default:
      return state
  }
}

export function useCheckoutState() {
  const [state, dispatch] = useReducer(checkoutReducer, initialState)
  return { state, dispatch }
}

export type { CheckoutAction }
