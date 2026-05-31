// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression cover for the logged-in pre-fill re-trigger. The wizard provider
 * stays mounted across wizard routes, so after "Neuer Besuch starten"
 * (resetWizard → persons RESET, same logged-in user) the pre-fill must re-run
 * even though userDoc.id is unchanged — otherwise /checkin shows empty
 * anonymous fields until a page reload. The trigger is a bumped `resetNonce`;
 * the effect is deliberately NOT keyed on `persons` (that would re-inject the
 * user into a guest slot the moment they remove themselves).
 */

import { afterEach, describe, expect, it } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import { useState } from "react"
import type { UserDoc } from "@modules/lib/auth"
import { usePreFillPerson } from "./wizard-context"
import { usePersonsState } from "./use-checkout-state"

afterEach(cleanup)

const userDoc: UserDoc = {
  id: "u-self",
  name: "Max Muster",
  firstName: "Max",
  lastName: "Muster",
  email: "max@example.com",
  phone: null,
  roles: [],
  permissions: [],
  userType: "erwachsen",
  termsAcceptedAt: { toDate: () => new Date() },
  activeMembership: null,
}

/** Wires the persons reducer to the pre-fill hook and exposes controls. */
function useHarness(doc: UserDoc | null) {
  const { persons, dispatch } = usePersonsState()
  const [nonce, setNonce] = useState(0)
  usePreFillPerson(doc, dispatch, persons, nonce)
  return { persons, dispatch, bumpNonce: () => setNonce((n) => n + 1) }
}

describe("usePreFillPerson", () => {
  it("pre-fills the empty primary person from the user doc", () => {
    const { result } = renderHook(() => useHarness(userDoc))
    expect(result.current.persons).toHaveLength(1)
    expect(result.current.persons[0]).toMatchObject({
      firstName: "Max",
      lastName: "Muster",
      email: "max@example.com",
      userId: "u-self",
      isPreFilled: true,
      termsAccepted: true,
    })
  })

  it("re-pre-fills after a RESET when the nonce is bumped (Neuer Besuch)", () => {
    const { result } = renderHook(() => useHarness(userDoc))
    expect(result.current.persons[0].userId).toBe("u-self")

    // Simulate resetWizard: clear the roster, then bump the nonce. userDoc.id
    // is unchanged, so only the nonce can re-trigger the pre-fill.
    act(() => {
      result.current.dispatch({ type: "RESET" })
      result.current.bumpNonce()
    })

    expect(result.current.persons).toHaveLength(1)
    expect(result.current.persons[0]).toMatchObject({
      userId: "u-self",
      firstName: "Max",
      isPreFilled: true,
    })
  })

  it("does not re-inject the user into a fresh guest slot after self-removal", () => {
    const { result } = renderHook(() => useHarness(userDoc))
    const selfId = result.current.persons[0].id

    // User removes themselves, then adds an empty guest slot — without a
    // reset/nonce bump the pre-fill must stay dormant (not in `persons` deps).
    act(() => {
      result.current.dispatch({ type: "REMOVE_PERSON", id: selfId })
      result.current.dispatch({ type: "ADD_PERSON" })
    })

    const filled = result.current.persons.filter((p) => p.userId === "u-self")
    expect(filled).toHaveLength(0)
    expect(result.current.persons.every((p) => !p.isPreFilled)).toBe(true)
  })

  it("does nothing when there is no identified user", () => {
    const { result } = renderHook(() => useHarness(null))
    expect(result.current.persons[0]).toMatchObject({
      firstName: "",
      lastName: "",
      isPreFilled: false,
    })
  })
})
