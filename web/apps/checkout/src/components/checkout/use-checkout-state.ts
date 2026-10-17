// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useReducer } from "react"
import { type UsageType, type UserType } from "@modules/lib/pricing"

/**
 * Reducer for the wizard's person roster (issue #209/#246). The step
 * counter and other transient wizard state (tip, submission
 * status) now live in the URL or in `WizardProvider` local state — only
 * the persons array still needs a reducer, since it's edited from
 * multiple places (PersonCard fields, identity pre-fill, rehydrate from
 * the open Firestore checkout).
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
  /**
   * The person's own usage type, chosen on the check-in (issue #605). It
   * decides their usage fee; the visit's type is derived from all of them
   * (`deriveVisitUsageType`).
   */
  usageType: UsageType
  /** The saved person this line came from (`users/{owner}/savedPersons`). */
  savedPersonId?: string
  /** "Für nächstes Mal speichern" is ticked (typed-in persons only). */
  saveForLater?: boolean
}

/** A saved person as the roster needs it (issue #605). */
export interface SavedPersonEntry {
  id: string
  firstName: string
  lastName: string
  userType: "erwachsen" | "kind"
}

export type PersonsAction =
  | { type: "ADD_PERSON" }
  | { type: "ADD_SAVED_PERSON"; saved: SavedPersonEntry }
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
    usageType: "regular",
  }
}

function personFromSaved(saved: SavedPersonEntry): CheckoutPerson {
  return {
    ...createEmptyPerson(),
    firstName: saved.firstName,
    lastName: saved.lastName,
    userType: saved.userType,
    // Only offered to identified sessions, whose terms are already accepted;
    // pre-filled = nothing to type or validate.
    termsAccepted: true,
    isPreFilled: true,
    savedPersonId: saved.id,
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

    case "ADD_SAVED_PERSON":
      // The menu only lists saved persons not on the visit; a double
      // dispatch must not add them twice.
      if (state.some((p) => p.savedPersonId === action.saved.id)) return state
      return [...state, personFromSaved(action.saved)]

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
