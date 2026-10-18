// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The terminal payment's screen state (ADR-0051): the server prices the
 * attempt, the kiosk bridge drives the terminal, and its result only
 * decides the phase — after a dropped connection the checkout document
 * decides whether the payment went through.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import type {
  TerminalPaymentEvent,
  TerminalPaymentRequest,
  TerminalPaymentResult,
} from "@oww/shared"

const mockPrepare = vi.fn()
const mockReport = vi.fn()
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: (_functions: unknown, _group: string, method: string) =>
    method === "reportTerminalApproval" ? mockReport : mockPrepare,
}))
vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
}))
vi.mock("@modules/lib/firestore-helpers", () => ({
  checkoutRef: (_db: unknown, id: string) => ({ id }),
}))
type SnapshotListener = (snap: { data: () => unknown }) => void
let snapshotListener: SnapshotListener | null = null
vi.mock("firebase/firestore", () => ({
  onSnapshot: (_ref: unknown, next: SnapshotListener) => {
    snapshotListener = next
    return () => {
      snapshotListener = null
    }
  },
}))
const mockToastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: mockToastError, success: vi.fn() } }))

const { useTerminalPayment, phaseForResult, TERMINAL_CHECK_MS } = await import(
  "./use-terminal-payment"
)

/** A kiosk bridge whose payment the test finishes by hand. */
function fakeBridge() {
  let finish: (r: TerminalPaymentResult) => void = () => {}
  let emit: (e: TerminalPaymentEvent) => void = () => {}
  const bridge = {
    terminalPay: vi.fn(
      (req: TerminalPaymentRequest) =>
        new Promise<TerminalPaymentResult>((resolve) => {
          finish = resolve
          void req
        }),
    ),
    onTerminalEvent: vi.fn((cb: (e: TerminalPaymentEvent) => void) => {
      emit = cb
      return () => {
        emit = () => {}
      }
    }),
    terminalAbort: vi.fn(async () => true),
  }
  return {
    bridge,
    finish: (outcome: TerminalPaymentResult["outcome"]) =>
      finish({ outcome, reference: "P-co1-1" }),
    emit: (e: TerminalPaymentEvent) => emit(e),
  }
}

const payload = async () => ({ personsPayload: [{ name: "Max" }], summary: { tip: 0 } })

function setup(fake = fakeBridge()) {
  const hook = renderHook(() =>
    useTerminalPayment({ checkoutId: "co1", bridge: fake.bridge, buildClosePayload: payload }),
  )
  return { ...fake, hook }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  mockPrepare.mockResolvedValue({
    data: {
      checkoutId: "co1",
      attempt: 1,
      reference: "P-co1-1",
      amount: 25,
      amountRappen: 2500,
      payerEmail: "max@example.com",
    },
  })
  mockReport.mockResolvedValue({ data: { status: "awaiting_payment" } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  mockPrepare.mockReset()
  mockReport.mockReset()
})

describe("phaseForResult", () => {
  it("maps every terminal outcome", () => {
    expect(phaseForResult({ outcome: "approved", reference: "r" }).phase).toBe("approved")
    expect(phaseForResult({ outcome: "declined", reference: "r" }).phase).toBe("declined")
    expect(phaseForResult({ outcome: "aborted", reference: "r" }).phase).toBe("declined")
    expect(phaseForResult({ outcome: "timeout", reference: "r" }).phase).toBe("timeout")
    expect(phaseForResult({ outcome: "unknown", reference: "r" }).phase).toBe("checking")
    for (const outcome of ["error", "busy", "unavailable"] as const) {
      const p = phaseForResult({ outcome, reference: "r" })
      expect(p.phase).toBe("error")
      expect(p.errorText).toBeTruthy()
    }
  })
})

describe("useTerminalPayment", () => {
  it("prices the attempt, arms the terminal and shows its progress", async () => {
    const { hook, bridge, emit, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()

    expect(mockPrepare).toHaveBeenCalledWith({
      checkoutId: "co1",
      persons: [{ name: "Max" }],
      summary: { tip: 0 },
    })
    expect(bridge.terminalPay).toHaveBeenCalledWith({ amountRappen: 2500, reference: "P-co1-1" })
    expect(hook.result.current.terminal).toMatchObject({
      phase: "waiting",
      amount: 25,
      payerEmail: "max@example.com",
    })

    act(() => emit({ type: "cardEntered", method: "card" }))
    expect(hook.result.current.terminal?.phase).toBe("processing")

    await act(async () => finish("approved"))
    expect(hook.result.current.terminal?.phase).toBe("approved")
    // The approval parks the checkout until Wallee confirms it (#812).
    expect(mockReport).toHaveBeenCalledWith({ checkoutId: "co1", attempt: 1 })
  })

  it("reports nothing for a declined payment", async () => {
    const { hook, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    await act(async () => finish("declined"))
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("still shows paid when the report fails, and flushReport waits for it", async () => {
    mockReport.mockRejectedValue(Object.assign(new Error("nope"), { code: "functions/failed-precondition" }))
    const { hook, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    await act(async () => finish("approved"))
    await act(async () => {
      await hook.result.current.flushReport()
    })
    expect(hook.result.current.terminal?.phase).toBe("approved")
    // Refused by the server: not retried.
    expect(mockReport).toHaveBeenCalledTimes(1)
  })

  it("retries a report the network dropped", async () => {
    mockReport
      .mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "functions/unavailable" }))
      .mockResolvedValueOnce({ data: { status: "awaiting_payment" } })
    const { hook, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    await act(async () => finish("approved"))
    await act(async () => {
      await hook.result.current.flushReport()
    })
    expect(mockReport).toHaveBeenCalledTimes(2)
  })

  it("offers a retry after a decline with a fresh attempt", async () => {
    const { hook, bridge, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    await act(async () => finish("declined"))
    expect(hook.result.current.terminal?.phase).toBe("declined")

    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    expect(mockPrepare).toHaveBeenCalledTimes(2)
    expect(bridge.terminalPay).toHaveBeenCalledTimes(2)
    expect(hook.result.current.terminal?.phase).toBe("waiting")
  })

  it("stops the terminal on abort and ignores its late answer", async () => {
    const { hook, bridge, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    await act(async () => {
      await hook.result.current.abort()
    })
    expect(bridge.terminalAbort).toHaveBeenCalled()
    expect(hook.result.current.terminal).toBeNull()

    await act(async () => finish("aborted"))
    expect(hook.result.current.terminal).toBeNull()
  })

  it("after a lost connection, a closed checkout means paid", async () => {
    const { hook, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    await act(async () => finish("unknown"))
    expect(hook.result.current.terminal?.phase).toBe("checking")

    act(() => snapshotListener?.({ data: () => ({ status: "open" }) }))
    expect(hook.result.current.terminal?.phase).toBe("checking")
    act(() =>
      snapshotListener?.({ data: () => ({ status: "closed", paymentMethod: "wallee_terminal" }) }),
    )
    expect(hook.result.current.terminal?.phase).toBe("approved")
  })

  it("after a lost connection, nothing arriving in time means unknown", async () => {
    vi.useFakeTimers()
    const { hook, finish } = setup()
    await act(async () => {
      void hook.result.current.start()
    })
    await flush()
    await act(async () => finish("unknown"))
    expect(hook.result.current.terminal?.phase).toBe("checking")
    act(() => vi.advanceTimersByTime(TERMINAL_CHECK_MS + 1))
    expect(hook.result.current.terminal?.phase).toBe("unknown")

    // A confirmation that arrives late still counts.
    act(() =>
      snapshotListener?.({ data: () => ({ status: "closed", paymentMethod: "wallee_terminal" }) }),
    )
    expect(hook.result.current.terminal?.phase).toBe("approved")
  })

  it("shows the server's refusal instead of arming the terminal", async () => {
    mockPrepare.mockRejectedValue(
      Object.assign(new Error("Das Terminal ist nicht eingerichtet."), {
        code: "functions/failed-precondition",
      }),
    )
    const { hook, bridge } = setup()
    await act(async () => {
      await hook.result.current.start()
    })
    expect(bridge.terminalPay).not.toHaveBeenCalled()
    expect(hook.result.current.terminal).toMatchObject({
      phase: "error",
      errorText: "Das Terminal ist nicht eingerichtet.",
    })
  })

  it("starts one attempt however fast the button is tapped", async () => {
    const { hook, bridge } = setup()
    await act(async () => {
      void hook.result.current.start()
      void hook.result.current.start()
    })
    await flush()
    expect(mockPrepare).toHaveBeenCalledTimes(1)
    expect(bridge.terminalPay).toHaveBeenCalledTimes(1)
  })

  it("prices nothing when aborted while the payment is being put together", async () => {
    let release: () => void = () => {}
    const slowPayload = () =>
      new Promise<{ personsPayload: unknown[]; summary: unknown }>((resolve) => {
        release = () => resolve({ personsPayload: [], summary: {} })
      })
    const fake = fakeBridge()
    const hook = renderHook(() =>
      useTerminalPayment({ checkoutId: "co1", bridge: fake.bridge, buildClosePayload: slowPayload }),
    )
    await act(async () => {
      void hook.result.current.start()
    })
    await act(async () => {
      await hook.result.current.abort()
    })
    await act(async () => {
      release()
    })
    await flush()
    expect(mockPrepare).not.toHaveBeenCalled()
    expect(hook.result.current.terminal).toBeNull()
  })

  it("shows paid when Wallee already closed the checkout from an earlier attempt", async () => {
    mockPrepare.mockRejectedValue(
      Object.assign(new Error("Dieser Besuch ist bereits abgeschlossen."), {
        code: "functions/failed-precondition",
        details: {
          reason: "checkout-closed",
          paidAtTerminal: true,
          amount: 25,
          payerEmail: "alice@example.com",
        },
      }),
    )
    mockToastError.mockClear()
    const { hook, bridge } = setup()
    await act(async () => {
      await hook.result.current.start()
    })
    expect(bridge.terminalPay).not.toHaveBeenCalled()
    expect(hook.result.current.terminal).toMatchObject({
      phase: "approved",
      amount: 25,
      payerEmail: "alice@example.com",
    })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("has nothing to pay when the checkout closed another way", async () => {
    mockPrepare.mockRejectedValue(
      Object.assign(new Error("Dieser Besuch ist bereits abgeschlossen."), {
        code: "functions/failed-precondition",
        details: { reason: "checkout-closed", paidAtTerminal: false },
      }),
    )
    const { hook } = setup()
    await act(async () => {
      await hook.result.current.start()
    })
    expect(hook.result.current.terminal?.phase).toBe("error")
  })
})
