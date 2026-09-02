// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression cover for the create-then-listen race seen on staging
 * (2026-09-02): the items listener must not open until the checkout create
 * is acknowledged by the server, otherwise the rules `get()` on the parent
 * refuses it and the cart stays blank until a reload. The latch has to be
 * set synchronously when the write is issued (before the latency-compensated
 * snapshot can surface the new checkout id) and released on settle — both
 * on success and on failure.
 */

import { afterEach, describe, expect, it } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import { useCheckoutCreateLatch } from "./wizard-context"

afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("useCheckoutCreateLatch", () => {
  it("is latched from the moment the write is issued until it is acknowledged", async () => {
    const { result } = renderHook(() => useCheckoutCreateLatch())
    expect(result.current.inFlight).toBe(false)

    const write = deferred<{ id: string }>()
    let outcome!: Promise<{ id: string }>
    act(() => {
      outcome = result.current.run(() => write.promise)
    })
    // Synchronously latched: the snapshot that surfaces the new checkout id
    // fires on a later task, so this render already sees inFlight.
    expect(result.current.inFlight).toBe(true)

    await act(async () => {
      write.resolve({ id: "co-1" })
      await outcome
    })
    expect(result.current.inFlight).toBe(false)
    await expect(outcome).resolves.toEqual({ id: "co-1" })
  })

  it("releases the latch and rethrows when the write fails", async () => {
    const { result } = renderHook(() => useCheckoutCreateLatch())

    const write = deferred<{ id: string }>()
    let outcome!: Promise<{ id: string }>
    act(() => {
      outcome = result.current.run(() => write.promise)
    })
    expect(result.current.inFlight).toBe(true)

    await act(async () => {
      write.reject(new Error("permission-denied"))
      await outcome.catch(() => undefined)
    })
    expect(result.current.inFlight).toBe(false)
    await expect(outcome).rejects.toThrow("permission-denied")
  })

  it("stays latched until every overlapping create has settled", async () => {
    const { result } = renderHook(() => useCheckoutCreateLatch())

    const first = deferred<{ id: string }>()
    const second = deferred<{ id: string }>()
    let firstOutcome!: Promise<{ id: string }>
    let secondOutcome!: Promise<{ id: string }>
    act(() => {
      firstOutcome = result.current.run(() => first.promise)
      secondOutcome = result.current.run(() => second.promise)
    })
    expect(result.current.inFlight).toBe(true)

    // The first ack alone must not reopen the listener: the second create is
    // still uncommitted on the server.
    await act(async () => {
      first.resolve({ id: "co-1" })
      await firstOutcome
    })
    expect(result.current.inFlight).toBe(true)

    await act(async () => {
      second.resolve({ id: "co-2" })
      await secondOutcome
    })
    expect(result.current.inFlight).toBe(false)
  })

  it("keeps `run` referentially stable across renders", () => {
    const { result, rerender } = renderHook(() => useCheckoutCreateLatch())
    const first = result.current.run
    rerender()
    expect(result.current.run).toBe(first)
  })
})
