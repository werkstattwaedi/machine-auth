// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// The payment session against the LTI simulator over real TCP. Timings are
// scaled down: the card arrives after 40 ms, other frames 5 ms apart.

import { test } from "node:test"
import assert from "node:assert/strict"
import type { TerminalPaymentEvent } from "@oww/shared"

import { startLtiSim, type LtiSim, type LtiSimScenario } from "../../scripts/lti-sim.ts"
import { mapErrorNotification, WalleeTerminal } from "./wallee-terminal.ts"

const REF = "S-a1B2c3D4e5F6g7H8i9J0-1"

async function withSim(
  scenario: LtiSimScenario,
  fn: (sim: LtiSim, terminal: WalleeTerminal) => Promise<void>,
  opts: { finalAnswerTimeoutMs?: number; cardDelayMs?: number } = {}
): Promise<void> {
  const sim = await startLtiSim({ scenario, cardDelayMs: opts.cardDelayMs ?? 40, stepMs: 5 })
  const terminal = new WalleeTerminal({
    host: "127.0.0.1",
    port: sim.port,
    posId: "KIOSK-TEST",
    finalAnswerTimeoutMs: opts.finalAnswerTimeoutMs ?? 2_000,
    probeTimeoutMs: 500,
    closeGraceMs: 10,
  })
  try {
    await fn(sim, terminal)
  } finally {
    await sim.close()
  }
}

function collect(): { events: TerminalPaymentEvent[]; onEvent: (e: TerminalPaymentEvent) => void } {
  const events: TerminalPaymentEvent[] = []
  return { events, onEvent: (e) => events.push(e) }
}

const until = async (cond: () => boolean, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("condition not met in time")
    await new Promise((r) => setTimeout(r, 2))
  }
}

test("approve: events in order and an approved result", async () => {
  await withSim("approve", async (sim, terminal) => {
    const { events, onEvent } = collect()
    const result = await terminal.pay({ amountRappen: 300, reference: REF }, onEvent)
    assert.deepEqual(result, { outcome: "approved", reference: REF, amountAuthRappen: 300, brand: "MastercardCtless" })
    assert.deepEqual(
      events.map((e) => e.type),
      ["started", "cardEntered", "cardRemoved", "display", "display"]
    )
    assert.deepEqual(events[1], { type: "cardEntered", method: "card" })
    assert.deepEqual(events[3], { type: "display", target: "cardholder", lines: ["", "Verarbeitung OK"] })
    const request = sim.received[0]
    assert.deepEqual(request, {
      kind: "financialTrxRequest",
      posId: "KIOSK-TEST",
      amount: 300,
      merchantReference: REF,
    })
    assert.equal(terminal.busy, false)
  })
})

test("TWINT: cardEntered with method qr, no cardRemoved", async () => {
  await withSim("twint-approve", async (_sim, terminal) => {
    const { events, onEvent } = collect()
    const result = await terminal.pay({ amountRappen: 300, reference: REF }, onEvent)
    assert.equal(result.outcome, "approved")
    assert.equal(result.brand, "TWINT")
    assert.deepEqual(events[1], { type: "cardEntered", method: "qr" })
    assert.ok(!events.some((e) => e.type === "cardRemoved"))
  })
})

test("decline", async () => {
  await withSim("decline", async (_sim, terminal) => {
    const result = await terminal.pay({ amountRappen: 100, reference: REF })
    assert.deepEqual(result, { outcome: "declined", reference: REF, brand: "MastercardCtless" })
  })
})

test("abort before the card: aborted event and result, abort sent silently", async () => {
  await withSim("abort-before-card", async (sim, terminal) => {
    const { events, onEvent } = collect()
    const paying = terminal.pay({ amountRappen: 300, reference: REF }, onEvent)
    await until(() => events.some((e) => e.type === "started"))
    assert.equal(await terminal.abort(), true)
    const result = await paying
    assert.deepEqual(result, {
      outcome: "aborted",
      reference: REF,
      errorCode: "TRM.PT.0002",
      errorText: "Stopp des Kunden",
    })
    assert.equal(events.at(-1)?.type, "aborted")
    assert.deepEqual(sim.received[1], { kind: "abortCardEntry", silentAbort: true })
  })
})

test("abort after the card was read is ignored; the payment still completes", async () => {
  await withSim("card-read-then-ignore-abort", async (_sim, terminal) => {
    const { events, onEvent } = collect()
    const paying = terminal.pay({ amountRappen: 300, reference: REF }, onEvent)
    await until(() => events.some((e) => e.type === "cardEntered"))
    assert.equal(terminal.cardRead, true)
    await terminal.abort()
    const result = await paying
    assert.equal(result.outcome, "approved")
    assert.ok(!events.some((e) => e.type === "aborted"))
  })
})

test("abort while still connecting never sends the request", async () => {
  await withSim("approve", async (sim, terminal) => {
    const paying = terminal.pay({ amountRappen: 300, reference: REF })
    assert.equal(await terminal.abort(), true)
    assert.deepEqual(await paying, { outcome: "aborted", reference: REF })
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(!sim.received.some((m) => m.kind === "financialTrxRequest"))
  })
})

test("abort without a running payment does nothing", async () => {
  await withSim("approve", async (_sim, terminal) => {
    assert.equal(await terminal.abort(), false)
  })
})

test("connection drop mid-transaction → unknown", async () => {
  await withSim("drop", async (_sim, terminal) => {
    const result = await terminal.pay({ amountRappen: 300, reference: REF })
    assert.equal(result.outcome, "unknown")
    assert.equal(terminal.busy, false)
  })
})

test("no final answer in time → unknown", async () => {
  await withSim(
    "hang",
    async (_sim, terminal) => {
      const result = await terminal.pay({ amountRappen: 300, reference: REF })
      assert.deepEqual(result, {
        outcome: "unknown",
        reference: REF,
        errorText: "no final answer from the terminal",
      })
    },
    { finalAnswerTimeoutMs: 150 }
  )
})

test("card-in timeout (TRM.PT.0201) → timeout", async () => {
  await withSim("timeout", async (_sim, terminal) => {
    const result = await terminal.pay({ amountRappen: 300, reference: REF })
    assert.deepEqual(result, { outcome: "timeout", reference: REF, errorCode: "TRM.PT.0201" })
  })
})

test("other terminal errors → error with the code", async () => {
  await withSim("unknown-card", async (_sim, terminal) => {
    const result = await terminal.pay({ amountRappen: 300, reference: REF })
    assert.deepEqual(result, { outcome: "error", reference: REF, errorCode: "TRM.PT.0500" })
  })
})

test("an unexpected confirmationRequest is ignored", async () => {
  await withSim("confirmation-request", async (_sim, terminal) => {
    const result = await terminal.pay({ amountRappen: 300, reference: REF })
    assert.equal(result.outcome, "approved")
  })
})

test("a second pay while one runs → busy, the first is untouched", async () => {
  await withSim("approve", async (sim, terminal) => {
    const first = terminal.pay({ amountRappen: 300, reference: REF })
    const second = await terminal.pay({ amountRappen: 500, reference: "S-other-1" })
    assert.deepEqual(second, { outcome: "busy", reference: "S-other-1" })
    assert.equal((await first).outcome, "approved")
    assert.equal(sim.connections, 1)
    // …and the terminal is free again afterwards.
    assert.equal((await terminal.pay({ amountRappen: 300, reference: REF })).outcome, "approved")
  })
})

test("terminal not reachable → unavailable", async () => {
  // 192.0.2.0/24 is TEST-NET-1: never routed, so the connect fails or times
  // out. (A closed localhost port isn't usable here: WSL2 accepts and then
  // resets such connections, which reads as a drop after connect.)
  const terminal = new WalleeTerminal({
    host: "192.0.2.1",
    port: 50000,
    posId: "KIOSK-TEST",
    connectTimeoutMs: 200,
    probeTimeoutMs: 200,
  })
  const result = await terminal.pay({ amountRappen: 300, reference: REF })
  assert.equal(result.outcome, "unavailable")
  assert.equal(terminal.busy, false)
  assert.equal((await terminal.health()).reachable, false)
  assert.equal(await terminal.terminalInfo(), null)
})

test("invalid requests are refused without connecting", async () => {
  await withSim("approve", async (sim, terminal) => {
    for (const req of [
      { amountRappen: 0, reference: REF },
      { amountRappen: 3.5, reference: REF },
      { amountRappen: 300, reference: "" },
      { amountRappen: 300, reference: "bad\nref" },
    ]) {
      const result = await terminal.pay(req)
      assert.equal(result.outcome, "error")
      assert.equal(result.errorCode, "invalid-request")
    }
    assert.equal(sim.connections, 0)
  })
})

test("health and terminalInfo", async () => {
  await withSim("approve", async (_sim, terminal) => {
    assert.deepEqual(await terminal.health(), { reachable: true })
    assert.deepEqual(await terminal.terminalInfo(), {
      terminalId: "12345678",
      hardwareType: "A35",
      softwareVersion: "1.2.54.1",
    })
  })
})

test("health during a payment answers busy without a second connection", async () => {
  await withSim("approve", async (sim, terminal) => {
    const paying = terminal.pay({ amountRappen: 300, reference: REF })
    assert.deepEqual(await terminal.health(), { reachable: true, busy: true })
    await paying
    assert.equal(sim.connections, 1)
  })
})

test("a payment started during a health probe waits for it", async () => {
  await withSim("approve", async (_sim, terminal) => {
    const health = terminal.health()
    const result = await terminal.pay({ amountRappen: 300, reference: REF })
    assert.equal(result.outcome, "approved")
    assert.equal((await health).reachable, true)
  })
})

test("a throwing event listener does not break the payment", async () => {
  await withSim("approve", async (_sim, terminal) => {
    const result = await terminal.pay({ amountRappen: 300, reference: REF }, () => {
      throw new Error("listener bug")
    })
    assert.equal(result.outcome, "approved")
  })
})

test("errorNotification mapping", () => {
  assert.deepEqual(mapErrorNotification("TRM.PT.0002", "Stopp des Kunden"), {
    outcome: "aborted",
    errorCode: "TRM.PT.0002",
    errorText: "Stopp des Kunden",
  })
  assert.deepEqual(mapErrorNotification("TRM.PT.0201", undefined), { outcome: "timeout", errorCode: "TRM.PT.0201" })
  assert.deepEqual(mapErrorNotification("TRM.PT.0003", "System Error"), {
    outcome: "error",
    errorCode: "TRM.PT.0003",
    errorText: "System Error",
  })
  assert.deepEqual(mapErrorNotification(undefined, undefined), { outcome: "error" })
})
