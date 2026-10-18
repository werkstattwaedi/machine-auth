// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Paying "Karte / TWINT" at the Wallee terminal next to the kiosk
 * (ADR-0051). The checkout stays open while the terminal runs: the server
 * prices an attempt (`prepareTerminalPayment`), the kiosk drives the
 * terminal, and Wallee's confirmation — not this screen — closes the
 * checkout and mails the Quittung (BIL-39).
 *
 * So the terminal's result only decides what this screen shows. After a
 * dropped connection ("unknown") nobody knows whether money moved; the
 * checkout document does: a confirmed payment closes it within a second,
 * so it is watched for a while before the person may pay again.
 *
 * The state lives in the wizard context, not the page: once Wallee closes
 * the checkout it drops out of the open-checkout query, and the page must
 * keep showing the payment (see `showNoCheckoutGate`).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { onSnapshot } from "firebase/firestore"
import type {
  TerminalPaymentEvent,
  TerminalPaymentRequest,
  TerminalPaymentResult,
} from "@oww/shared"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { checkoutRef } from "@modules/lib/firestore-helpers"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"

/** The kiosk bridge's terminal methods (`useBridge`); absent outside the kiosk. */
export interface TerminalBridge {
  terminalPay?: (req: TerminalPaymentRequest) => Promise<TerminalPaymentResult>
  onTerminalEvent?: (cb: (event: TerminalPaymentEvent) => void) => () => void
  terminalAbort?: () => Promise<boolean>
}

export type TerminalPhase =
  /** Pricing the attempt on the server. */
  | "preparing"
  /** The terminal waits for a card or a TWINT scan. */
  | "waiting"
  /** A card was read: the payment runs; it can't be stopped any more. */
  | "processing"
  /** The terminal approved it. */
  | "approved"
  /** Declined, or stopped at the terminal. */
  | "declined"
  /** No card within the terminal's time. */
  | "timeout"
  /** The terminal or the server refused to start (unreachable, busy, error). */
  | "error"
  /** The connection dropped mid-payment: watching the checkout. */
  | "checking"
  /** Nothing arrived while watching. */
  | "unknown"

/** Phases during which the payment must not be interrupted. */
export const TERMINAL_BUSY_PHASES: ReadonlySet<TerminalPhase> = new Set([
  "preparing",
  "waiting",
  "processing",
  "checking",
])

export interface TerminalPaymentState {
  phase: TerminalPhase
  checkoutId: string
  /** CHF, what the attempt charges; null until it is priced. */
  amount: number | null
  /** Where the Quittung goes. */
  payerEmail: string
  /** Shown with "error" (German). */
  errorText: string | null
}

/** How long a lost connection is answered by watching the checkout. */
export const TERMINAL_CHECK_MS = 10_000

interface PrepareResponse {
  checkoutId: string
  reference: string
  amount: number
  amountRappen: number
  payerEmail: string
}

interface ClosePayload {
  personsPayload: unknown[]
  summary: unknown
}

const SERVER_MESSAGE_CODES: readonly string[] = ["functions/failed-precondition"]

/**
 * The server's refusal when the checkout already closed (`details.reason`),
 * most often because Wallee settled a payment this screen lost track of.
 */
const CHECKOUT_CLOSED_REASON = "checkout-closed"

type PrepareOutcome =
  | { kind: "prepared"; prepared: PrepareResponse }
  | ({ kind: "closed" } & ClosedDetails)

interface ClosedDetails {
  paidAtTerminal: boolean
  /** What it was paid with and where the Quittung goes, when paid at the terminal. */
  amount: number | null
  payerEmail: string | null
}

function checkoutClosedDetails(err: unknown): ClosedDetails | null {
  const details = (err as { details?: unknown } | null)?.details as
    | { reason?: unknown; paidAtTerminal?: unknown; amount?: unknown; payerEmail?: unknown }
    | undefined
  if (details?.reason !== CHECKOUT_CLOSED_REASON) return null
  return {
    paidAtTerminal: details.paidAtTerminal === true,
    amount: typeof details.amount === "number" ? details.amount : null,
    payerEmail: typeof details.payerEmail === "string" ? details.payerEmail : null,
  }
}

/** The terminal's result as this screen's phase. Exported for tests. */
export function phaseForResult(result: TerminalPaymentResult): {
  phase: TerminalPhase
  errorText: string | null
} {
  switch (result.outcome) {
    case "approved":
      return { phase: "approved", errorText: null }
    case "declined":
    case "aborted":
      return { phase: "declined", errorText: null }
    case "timeout":
      return { phase: "timeout", errorText: null }
    case "unknown":
      return { phase: "checking", errorText: null }
    case "unavailable":
      return { phase: "error", errorText: "Das Terminal ist gerade nicht erreichbar." }
    case "busy":
      return { phase: "error", errorText: "Am Terminal läuft noch eine andere Zahlung." }
    case "error":
    default:
      // "Karte unbekannt" and friends: the card can't pay here.
      return {
        phase: "error",
        errorText: "Die Zahlung konnte nicht ausgeführt werden.",
      }
  }
}

export function useTerminalPayment(args: {
  checkoutId: string | null
  bridge: TerminalBridge
  buildClosePayload: () => Promise<ClosePayload | null>
}) {
  const { checkoutId, bridge, buildClosePayload } = args
  const db = useDb()
  const functions = useFunctions()
  const [terminal, setTerminal] = useState<TerminalPaymentState | null>(null)
  // Results of an attempt the person already left (abort, a newer try)
  // must not repaint the screen.
  const runRef = useRef(0)
  // The phase as of now, not as of the last render: two taps in one tick
  // must not start two attempts.
  const phaseRef = useRef<TerminalPhase | null>(null)
  const prepare = useAsyncMutation<PrepareOutcome>({
    context: "checkout.prepareTerminalPayment",
    errorMessage: "Die Zahlung am Terminal konnte nicht gestartet werden.",
    serverMessageCodes: SERVER_MESSAGE_CODES,
  })

  const update = useCallback((run: number, patch: Partial<TerminalPaymentState>) => {
    if (run !== runRef.current) return
    if (patch.phase) phaseRef.current = patch.phase
    setTerminal((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const start = useCallback(async () => {
    if (!checkoutId || !bridge.terminalPay) return
    if (phaseRef.current && TERMINAL_BUSY_PHASES.has(phaseRef.current)) return
    const run = ++runRef.current
    phaseRef.current = "preparing"
    setTerminal({
      phase: "preparing",
      checkoutId,
      amount: terminal?.amount ?? null,
      payerEmail: terminal?.payerEmail ?? "",
      errorText: null,
    })

    const payload = await buildClosePayload()
    // "Abbrechen" before anything was priced: no attempt for a dead run.
    if (run !== runRef.current) return
    if (!payload) {
      update(run, { phase: "error", errorText: "Die Zahlung konnte nicht vorbereitet werden." })
      return
    }
    let outcome: PrepareOutcome
    try {
      outcome = await prepare.mutate(async (): Promise<PrepareOutcome> => {
        const call = rpcCallable<
          { checkoutId: string; persons: unknown[]; summary: unknown },
          PrepareResponse
        >(functions, "billingCall", "prepareTerminalPayment")
        try {
          const res = await call({
            checkoutId,
            persons: payload.personsPayload,
            summary: payload.summary,
          })
          return { kind: "prepared", prepared: res.data }
        } catch (err) {
          // Not a failure to toast: the checkout is done.
          const closed = checkoutClosedDetails(err)
          if (closed) return { kind: "closed", ...closed }
          throw err
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      update(run, {
        phase: "error",
        errorText: message || "Die Zahlung am Terminal konnte nicht gestartet werden.",
      })
      return
    }
    // "Abbrechen" while the attempt was being priced.
    if (run !== runRef.current) return
    if (outcome.kind === "closed") {
      // Wallee settled an earlier attempt (the screen lost its result):
      // that is the payment. Closed any other way, there is nothing to pay.
      update(
        run,
        outcome.paidAtTerminal
          ? {
            phase: "approved",
            errorText: null,
            // The first try of this screen has priced nothing yet.
            ...(outcome.amount !== null ? { amount: outcome.amount } : {}),
            ...(outcome.payerEmail ? { payerEmail: outcome.payerEmail } : {}),
          }
          : { phase: "error", errorText: "Dieser Besuch ist bereits abgeschlossen." },
      )
      return
    }
    const { prepared } = outcome
    update(run, {
      phase: "waiting",
      amount: prepared.amount,
      payerEmail: prepared.payerEmail,
    })

    const unsubscribe = bridge.onTerminalEvent?.((event: TerminalPaymentEvent) => {
      if (event.type === "cardEntered") update(run, { phase: "processing" })
    })
    try {
      const result = await bridge.terminalPay({
        amountRappen: prepared.amountRappen,
        reference: prepared.reference,
      })
      update(run, phaseForResult(result))
    } finally {
      unsubscribe?.()
    }
  }, [checkoutId, bridge, buildClosePayload, functions, prepare, terminal, update])

  /**
   * Leaves the terminal: stops it if it still waits for a card. Once a card
   * was read the terminal ignores the stop; the money may still arrive and
   * Wallee settles it (or, should the person have moved on, it is a double
   * charge refunded by hand).
   */
  const abort = useCallback(async () => {
    runRef.current++
    phaseRef.current = null
    setTerminal(null)
    await bridge.terminalAbort?.()
  }, [bridge])

  const clear = useCallback(() => {
    runRef.current++
    phaseRef.current = null
    setTerminal(null)
  }, [])

  // After a dropped connection: Wallee closes the checkout within a second
  // of a payment that went through. Watch it before calling it lost — and
  // keep watching while "unknown" is shown, so a late confirmation still
  // turns the screen to paid instead of offering to pay again.
  const watchedCheckoutId =
    terminal?.phase === "checking" || terminal?.phase === "unknown"
      ? terminal.checkoutId
      : null
  useEffect(() => {
    if (!watchedCheckoutId) return
    const run = runRef.current
    return onSnapshot(
      checkoutRef(db, watchedCheckoutId),
      (snap) => {
        const doc = snap.data()
        if (doc && doc.status !== "open" && doc.paymentMethod === "wallee_terminal") {
          update(run, { phase: "approved" })
        }
      },
      () => {
        // A read error proves nothing either way: the timer decides.
      },
    )
  }, [watchedCheckoutId, db, update])
  const checking = terminal?.phase === "checking"
  useEffect(() => {
    if (!checking) return
    const run = runRef.current
    const timer = setTimeout(() => update(run, { phase: "unknown" }), TERMINAL_CHECK_MS)
    return () => clearTimeout(timer)
  }, [checking, update])

  return { terminal, start, abort, clear }
}
