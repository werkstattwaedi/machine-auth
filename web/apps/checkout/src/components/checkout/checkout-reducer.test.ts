// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  checkoutReducer,
  initialState,
  type CheckoutState,
  type CheckoutAction,
} from "./use-checkout-state"

function reduce(
  action: CheckoutAction,
  state: CheckoutState = initialState,
): CheckoutState {
  return checkoutReducer(state, action)
}

describe("checkoutReducer", () => {
  describe("initialState", () => {
    it("starts at step 0 with one empty person", () => {
      expect(initialState.step).toBe(0)
      expect(initialState.persons).toHaveLength(1)
      expect(initialState.usageType).toBe("regular")
      expect(initialState.tip).toBe(0)
      expect(initialState.submitted).toBe(false)
      expect(initialState.checkoutId).toBeNull()
      expect(initialState.totalPrice).toBe(0)
    })

    it("does not carry the legacy localItems field (issue #151)", () => {
      // Anonymous users now sign in eagerly after step 1 and write items
      // straight to Firestore — there is no in-memory cart any more.
      expect("localItems" in initialState).toBe(false)
    })
  })

  describe("SET_STEP", () => {
    it("changes the current step", () => {
      expect(reduce({ type: "SET_STEP", step: 2 }).step).toBe(2)
    })
  })

  describe("ADD_PERSON", () => {
    it("adds a new empty person", () => {
      const state = reduce({ type: "ADD_PERSON" })
      expect(state.persons).toHaveLength(2)
      expect(state.persons[1].firstName).toBe("")
      expect(state.persons[1].isPreFilled).toBe(false)
    })

    it("generates unique IDs", () => {
      let state = reduce({ type: "ADD_PERSON" })
      state = checkoutReducer(state, { type: "ADD_PERSON" })
      const ids = state.persons.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe("REMOVE_PERSON", () => {
    it("removes the person with matching id", () => {
      const state = reduce({ type: "ADD_PERSON" })
      const idToRemove = state.persons[1].id
      const result = checkoutReducer(state, {
        type: "REMOVE_PERSON",
        id: idToRemove,
      })
      expect(result.persons).toHaveLength(1)
      expect(result.persons.find((p) => p.id === idToRemove)).toBeUndefined()
    })

    it("does nothing for non-existent id", () => {
      const state = reduce({
        type: "REMOVE_PERSON",
        id: "nonexistent",
      })
      expect(state.persons).toHaveLength(1)
    })
  })

  describe("UPDATE_PERSON", () => {
    it("updates fields on the matching person", () => {
      const personId = initialState.persons[0].id
      const state = reduce({
        type: "UPDATE_PERSON",
        id: personId,
        updates: { firstName: "Max", lastName: "Muster" },
      })
      expect(state.persons[0].firstName).toBe("Max")
      expect(state.persons[0].lastName).toBe("Muster")
    })

    it("updates billing address fields", () => {
      const personId = initialState.persons[0].id
      const state = reduce({
        type: "UPDATE_PERSON",
        id: personId,
        updates: {
          billingCompany: "Werkstatt AG",
          billingStreet: "Seestrasse 1",
          billingZip: "8820",
          billingCity: "Wädenswil",
        },
      })
      expect(state.persons[0].billingCompany).toBe("Werkstatt AG")
      expect(state.persons[0].billingStreet).toBe("Seestrasse 1")
      expect(state.persons[0].billingZip).toBe("8820")
      expect(state.persons[0].billingCity).toBe("Wädenswil")
    })

    it("leaves other persons unchanged", () => {
      let state = reduce({ type: "ADD_PERSON" })
      state = checkoutReducer(state, {
        type: "UPDATE_PERSON",
        id: state.persons[1].id,
        updates: { firstName: "Anna" },
      })
      expect(state.persons[0].firstName).toBe("")
      expect(state.persons[1].firstName).toBe("Anna")
    })
  })

  describe("SET_USAGE_TYPE", () => {
    it("changes the usage type", () => {
      expect(
        reduce({ type: "SET_USAGE_TYPE", usageType: "materialbezug" }).usageType,
      ).toBe("materialbezug")
    })
  })

  describe("SET_TIP", () => {
    it("sets the tip amount", () => {
      expect(reduce({ type: "SET_TIP", amount: 5 }).tip).toBe(5)
    })

    it("clamps negative tip to zero", () => {
      expect(reduce({ type: "SET_TIP", amount: -3 }).tip).toBe(0)
    })

    it("allows zero tip", () => {
      expect(reduce({ type: "SET_TIP", amount: 0 }).tip).toBe(0)
    })
  })

  describe("SET_SUBMITTED", () => {
    it("marks as submitted with checkout ID and total", () => {
      const state = reduce({
        type: "SET_SUBMITTED",
        checkoutId: "co123",
        totalPrice: 42.5,
      })
      expect(state.submitted).toBe(true)
      expect(state.checkoutId).toBe("co123")
      expect(state.totalPrice).toBe(42.5)
    })
  })

  describe("RESET", () => {
    it("restores initial state", () => {
      let state = reduce({ type: "SET_STEP", step: 2 })
      state = checkoutReducer(state, { type: "SET_TIP", amount: 10 })
      state = checkoutReducer(state, { type: "ADD_PERSON" })
      state = checkoutReducer(state, { type: "RESET" })

      expect(state.step).toBe(0)
      expect(state.tip).toBe(0)
      expect(state.persons).toHaveLength(1)
      expect(state.submitted).toBe(false)
    })
  })

  describe("unknown action", () => {
    it("returns state unchanged", () => {
      const state = reduce({ type: "UNKNOWN" } as unknown as CheckoutAction)
      expect(state).toEqual(initialState)
    })
  })
})
