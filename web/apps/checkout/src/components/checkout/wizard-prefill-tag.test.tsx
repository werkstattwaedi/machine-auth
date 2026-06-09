// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression cover for issue #420 — "reading the badge has no effect after
 * switching". The wizard provider stays mounted across taps; when a second
 * badge is tapped while the first is already pre-filled, the primary person
 * card must be overwritten with the new identity. The old guard bailed on
 * `primary.isPreFilled` and swallowed the switch, leaving the first badge's
 * name on the card.
 *
 * This test exercises the tag pre-fill hook directly with two distinct
 * `tokenUser` identities and asserts the second one replaces the first, while
 * verifying the hook does not clobber a roster pre-filled by another source
 * (logged-in pre-fill / open-checkout rehydrate).
 */

import { afterEach, describe, expect, it } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import { useState } from "react"
import type { TokenUser } from "@modules/lib/token-auth"
import { usePreFillTagPerson } from "./wizard-context"
import { usePersonsState } from "./use-checkout-state"

afterEach(cleanup)

const tagUserA: TokenUser = {
  tokenId: "tag-a",
  userId: "u-a",
  firstName: "Alice",
  lastName: "Anders",
  email: "alice@test.com",
  userType: "erwachsen",
}

const tagUserB: TokenUser = {
  tokenId: "tag-b",
  userId: "u-b",
  firstName: "Bob",
  lastName: "Berger",
  email: "bob@test.com",
  userType: "erwachsen",
}

/** Wires the persons reducer to the tag pre-fill hook with a swappable user. */
function useHarness(initial: TokenUser | null) {
  const { persons, dispatch } = usePersonsState()
  const [tokenUser, setTokenUser] = useState<TokenUser | null>(initial)
  usePreFillTagPerson(tokenUser, dispatch, persons)
  return { persons, dispatch, setTokenUser }
}

describe("usePreFillTagPerson", () => {
  it("pre-fills the empty primary person from the tag user", () => {
    const { result } = renderHook(() => useHarness(tagUserA))
    expect(result.current.persons).toHaveLength(1)
    expect(result.current.persons[0]).toMatchObject({
      firstName: "Alice",
      lastName: "Anders",
      email: "alice@test.com",
      isPreFilled: true,
      termsAccepted: true,
    })
  })

  it("overwrites the primary card when a different badge is tapped (#420)", () => {
    const { result } = renderHook(() => useHarness(tagUserA))
    expect(result.current.persons[0].firstName).toBe("Alice")

    // Switch badges: a new tokenUser arrives while the first is pre-filled.
    act(() => {
      result.current.setTokenUser(tagUserB)
    })

    expect(result.current.persons).toHaveLength(1)
    expect(result.current.persons[0]).toMatchObject({
      firstName: "Bob",
      lastName: "Berger",
      email: "bob@test.com",
      isPreFilled: true,
    })
  })

  it("is idempotent for repeated reads of the same badge", () => {
    const { result } = renderHook(() => useHarness(tagUserA))
    const firstId = result.current.persons[0].id

    // Re-supply the same identity (e.g. a re-render); the card must not be
    // rewritten with a new person identity or duplicated.
    act(() => {
      result.current.setTokenUser({ ...tagUserA })
    })

    expect(result.current.persons).toHaveLength(1)
    // Same person card object identity preserved (no dispatch fired).
    expect(result.current.persons[0].id).toBe(firstId)
    expect(result.current.persons[0].firstName).toBe("Alice")
  })

  it("does not clobber a primary pre-filled by another source", () => {
    // Simulate a roster rehydrated from an open checkout: the primary arrives
    // already pre-filled before any tag user is present.
    const { result } = renderHook(() => useHarness(null))
    act(() => {
      result.current.dispatch({
        type: "UPDATE_PERSON",
        id: result.current.persons[0].id,
        updates: {
          firstName: "Carol",
          lastName: "Conrad",
          email: "carol@test.com",
          isPreFilled: true,
        },
      })
    })

    // Now a tag user appears. Because the existing pre-fill was not produced
    // by this hook, it must be left intact.
    act(() => {
      result.current.setTokenUser(tagUserA)
    })

    expect(result.current.persons[0]).toMatchObject({
      firstName: "Carol",
      lastName: "Conrad",
      isPreFilled: true,
    })
  })

  it("does nothing when there is no tag user", () => {
    const { result } = renderHook(() => useHarness(null))
    expect(result.current.persons[0]).toMatchObject({
      firstName: "",
      lastName: "",
      isPreFilled: false,
    })
  })
})
