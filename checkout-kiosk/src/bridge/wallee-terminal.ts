// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Drives the Wallee A35 over the Local Till Interface (ADR-0048, plan
// docs/plans/wallee-terminal.md §2). One use case at a time, one TCP
// connection per use case: connect, send the request, read frames until the
// final response or errorNotification, then close — the terminal never
// closes the socket itself.
//
// The result is for display only. Nothing is booked on it: the Wallee
// webhook settles the checkout server-side. That is why every doubt maps to
// `unknown` instead of a guess — the UI then checks the checkout.

import net from "node:net"
import type {
  TerminalPaymentEvent,
  TerminalPaymentRequest,
  TerminalPaymentResult,
} from "@oww/shared"
import {
  abortCardEntryNotification,
  encodeFrame,
  financialTrxRequest,
  FrameDecoder,
  type LtiMessage,
  parseLtiMessage,
  pingRequest,
  pinpadInformationRequest,
} from "./lti-codec"

/** Customer (or attendant) pressed Stop, or our abortCardEntryNotification took effect. */
export const LTI_ERROR_CUSTOMER_STOP = "TRM.PT.0002"
/** No card was presented within the terminal's card-in timeout (spec §6.14.1). */
export const LTI_ERROR_CARD_NOT_DETECTED = "TRM.PT.0201"

export interface WalleeTerminalOptions {
  host: string
  port: number
  posId: string
  /** TCP connect; a failure here means the terminal is unavailable. */
  connectTimeoutMs?: number
  /**
   * Longest wait for the final answer after the request is sent. The
   * terminal's own timeouts (toCardIn 30 s, toPosTrxRq 45 s) end a stuck
   * transaction well before this, so hitting it means something is wrong.
   */
  finalAnswerTimeoutMs?: number
  /** Ping / pinpad information. */
  probeTimeoutMs?: number
  /** Time the terminal gets to see our FIN before the socket is destroyed. */
  closeGraceMs?: number
  log?: (level: "info" | "warn", message: string) => void
}

export interface TerminalHealth {
  reachable: boolean
  /** A payment is running; we didn't open a second connection to ask. */
  busy?: boolean
  error?: string
}

export interface TerminalInfo {
  /** EP2 terminal id (not the Wallee backend terminal id). */
  terminalId?: string
  hardwareType?: string
  softwareVersion?: string
}

interface Session {
  reference: string
  socket: net.Socket | null
  requestSent: boolean
  cardRead: boolean
  abortRequested: boolean
  /** Ends the session before the request went out (abort while connecting). */
  cancel: (() => void) | null
}

const DEFAULTS = {
  connectTimeoutMs: 5_000,
  finalAnswerTimeoutMs: 120_000,
  probeTimeoutMs: 5_000,
  closeGraceMs: 1_000,
}

// EP2 "ans": printable Latin-1. Ours are stricter ({P|S}-id-attempt), but the
// kiosk only refuses what the terminal would refuse — the format is the
// backend's business.
const ANS = /^[\x20-\x7e\xa0-\xff]{1,64}$/
// Far above any checkout; guards against a unit mix-up (CHF vs Rappen).
const MAX_AMOUNT_RAPPEN = 10_000_00

function validatePayRequest(req: TerminalPaymentRequest): string | null {
  if (!Number.isInteger(req?.amountRappen) || req.amountRappen <= 0) {
    return "amountRappen must be a positive integer"
  }
  if (req.amountRappen > MAX_AMOUNT_RAPPEN) return "amountRappen too large"
  if (typeof req.reference !== "string" || !ANS.test(req.reference)) {
    return "reference is not a valid merchantReference"
  }
  return null
}

export class WalleeTerminal {
  private readonly opts: Required<Omit<WalleeTerminalOptions, "log">> &
    Pick<WalleeTerminalOptions, "log">
  private session: Session | null = null
  private probeChain: Promise<unknown> = Promise.resolve()

  constructor(options: WalleeTerminalOptions) {
    this.opts = { ...DEFAULTS, ...options }
  }

  /** True while a payment is running. */
  get busy(): boolean {
    return this.session !== null
  }

  /** True once the running payment's card was read (an abort no longer works). */
  get cardRead(): boolean {
    return this.session?.cardRead ?? false
  }

  /**
   * Run one payment. Never rejects: every failure is an outcome. A second
   * call while one runs resolves `busy` right away and leaves the first
   * untouched.
   */
  async pay(
    req: TerminalPaymentRequest,
    onEvent: (event: TerminalPaymentEvent) => void = () => {}
  ): Promise<TerminalPaymentResult> {
    const reference = typeof req?.reference === "string" ? req.reference : ""
    if (this.session) return { outcome: "busy", reference }
    const invalid = validatePayRequest(req)
    if (invalid) {
      return { outcome: "error", reference, errorCode: "invalid-request", errorText: invalid }
    }
    // Claimed before the first await, so a concurrent pay sees it.
    const session: Session = {
      reference,
      socket: null,
      requestSent: false,
      cardRead: false,
      abortRequested: false,
      cancel: null,
    }
    this.session = session
    try {
      // A health probe may hold its own connection; the terminal serves one
      // use case at a time, so let it finish (it is short) instead of racing.
      await this.probeChain.catch(() => {})
      const result = await this.runPayment(session, req.amountRappen, onEvent)
      this.log("info", `payment ${reference} ended: ${result.outcome}${result.errorCode ? ` (${result.errorCode})` : ""}`)
      return result
    } finally {
      this.session = null
    }
  }

  /**
   * Ask the terminal to stop waiting for a card. Resolves true when the
   * abort was sent (or the payment hadn't reached the terminal yet). Once the
   * card is read the terminal ignores it and the payment's own result still
   * arrives — the caller must keep waiting for it.
   */
  async abort(): Promise<boolean> {
    const session = this.session
    if (!session) return false
    session.abortRequested = true
    if (!session.requestSent) {
      session.cancel?.()
      return true
    }
    if (session.cardRead) {
      this.log("info", `abort for ${session.reference} after the card was read — the terminal will ignore it`)
    }
    const socket = session.socket
    if (!socket || socket.destroyed) return false
    return new Promise<boolean>((resolve) => {
      try {
        socket.write(encodeFrame(abortCardEntryNotification(true)), (err) => resolve(!err))
      } catch {
        resolve(false)
      }
    })
  }

  /** pingRequest with a short timeout. Doesn't touch a running payment. */
  async health(): Promise<TerminalHealth> {
    if (this.session) return { reachable: true, busy: true }
    try {
      await this.probe(pingRequest(), "pingResponse")
      return { reachable: true }
    } catch (err) {
      return { reachable: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** The terminal's EP2 id and model via pinpadInformationRequest; null if unreachable or busy. */
  async terminalInfo(): Promise<TerminalInfo | null> {
    if (this.session) return null
    try {
      const msg = await this.probe(pinpadInformationRequest(this.opts.posId), "pinpadInformation")
      if (msg.kind !== "pinpadInformation") return null
      return {
        terminalId: msg.terminalId,
        hardwareType: msg.hardwareType,
        softwareVersion: msg.softwareVersion,
      }
    } catch {
      return null
    }
  }

  // ── internals ──────────────────────────────────────────────────

  private log(level: "info" | "warn", message: string): void {
    this.opts.log?.(level, `[terminal] ${message}`)
  }

  private connect(): net.Socket {
    const socket = net.connect({ host: this.opts.host, port: this.opts.port })
    socket.setNoDelay(true)
    return socket
  }

  private close(socket: net.Socket, connected: boolean): void {
    if (socket.destroyed) return
    if (!connected) {
      socket.destroy()
      return
    }
    socket.end()
    setTimeout(() => socket.destroy(), this.opts.closeGraceMs).unref()
  }

  private runPayment(
    session: Session,
    amountRappen: number,
    onEvent: (event: TerminalPaymentEvent) => void
  ): Promise<TerminalPaymentResult> {
    const reference = session.reference
    if (session.abortRequested) {
      return Promise.resolve({ outcome: "aborted", reference })
    }
    return new Promise<TerminalPaymentResult>((resolve) => {
      let done = false
      let connected = false
      let finalTimer: ReturnType<typeof setTimeout> | undefined
      const decoder = new FrameDecoder()
      const socket = this.connect()
      session.socket = socket

      const finish = (result: Omit<TerminalPaymentResult, "reference">): void => {
        if (done) return
        done = true
        clearTimeout(connectTimer)
        clearTimeout(finalTimer)
        session.cancel = null
        this.close(socket, connected)
        resolve({ ...result, reference })
      }
      const emit = (event: TerminalPaymentEvent): void => {
        try {
          onEvent(event)
        } catch (err) {
          this.log("warn", `event listener threw: ${err instanceof Error ? err.message : err}`)
        }
      }

      const connectTimer = setTimeout(
        () => finish({ outcome: "unavailable", errorText: "connect timeout" }),
        this.opts.connectTimeoutMs
      )
      session.cancel = () => finish({ outcome: "aborted" })

      socket.once("connect", () => {
        connected = true
        clearTimeout(connectTimer)
        if (session.abortRequested) {
          finish({ outcome: "aborted" })
          return
        }
        socket.write(
          encodeFrame(
            financialTrxRequest({
              posId: this.opts.posId,
              amountRappen,
              merchantReference: reference,
            })
          )
        )
        session.requestSent = true
        finalTimer = setTimeout(
          () => finish({ outcome: "unknown", errorText: "no final answer from the terminal" }),
          this.opts.finalAnswerTimeoutMs
        )
      })

      socket.on("data", (chunk: Buffer) => {
        let frames: string[]
        try {
          frames = decoder.push(chunk)
        } catch (err) {
          this.log("warn", `framing error: ${err instanceof Error ? err.message : err}`)
          finish({ outcome: "unknown", errorText: "framing error" })
          return
        }
        for (const xml of frames) {
          if (done) return
          let msg: LtiMessage
          try {
            msg = parseLtiMessage(xml)
          } catch (err) {
            // One bad frame must not end a payment that may still succeed.
            this.log("warn", `ignoring unparsable frame: ${err instanceof Error ? err.message : err}`)
            continue
          }
          this.onMessage(session, msg, amountRappen, emit, finish)
        }
      })

      socket.on("error", (err) => {
        finish(
          connected
            ? { outcome: "unknown", errorText: err.message }
            : { outcome: "unavailable", errorText: err.message }
        )
      })
      socket.on("close", () => {
        finish(
          connected
            ? { outcome: "unknown", errorText: "connection closed by the terminal" }
            : { outcome: "unavailable", errorText: "connection closed" }
        )
      })
    })
  }

  private onMessage(
    session: Session,
    msg: LtiMessage,
    amountRappen: number,
    emit: (event: TerminalPaymentEvent) => void,
    finish: (result: Omit<TerminalPaymentResult, "reference">) => void
  ): void {
    switch (msg.kind) {
      case "trxStart":
        emit({ type: "started" })
        return
      case "cardEntry":
        session.cardRead = true
        emit({ type: "cardEntered", method: "card" })
        return
      case "qrCodeScan":
        session.cardRead = true
        emit({ type: "cardEntered", method: "qr" })
        return
      case "cardRemoval":
        emit({ type: "cardRemoved" })
        return
      case "display":
        emit({
          type: "display",
          target: msg.displayType === "ATTENDANT" ? "attendant" : "cardholder",
          lines: msg.lines,
        })
        return
      case "trxAbort":
        // The errorNotification that follows ends the use case.
        emit({ type: "aborted" })
        return
      case "financialTrxResponse": {
        if (msg.merchantReference && msg.merchantReference !== session.reference) {
          this.log("warn", `response echoes ${msg.merchantReference}, expected ${session.reference}`)
        }
        if (msg.trxResult === 0) {
          if (msg.amountAuth !== undefined && msg.amountAuth < amountRappen) {
            // partialApprovalCap=0 should prevent this; the backend's amount
            // check is what catches it.
            this.log("warn", `partial approval: ${msg.amountAuth} of ${amountRappen}`)
          }
          finish({ outcome: "approved", amountAuthRappen: msg.amountAuth, brand: msg.cardAppLabel })
        } else {
          finish({ outcome: "declined", brand: msg.cardAppLabel })
        }
        return
      }
      case "error":
        finish(mapErrorNotification(msg.errorCode, msg.errorText))
        return
      case "confirmationRequest":
        // Only sent for reversals or confirmation features we don't enable.
        // Unanswered, the terminal concludes on its own timeout.
        this.log("warn", `ignoring confirmationRequest: ${msg.lines.join(" / ")}`)
        return
      case "printer":
      case "trxEnd":
        return
      default:
        this.log("info", `ignoring ${msg.kind === "unknown" ? msg.root : msg.kind}`)
    }
  }

  /**
   * One request/response use case on its own connection, serialised with
   * other probes. Rejects on timeout, connection failure or an
   * errorNotification.
   */
  private probe(xml: string, expect: LtiMessage["kind"]): Promise<LtiMessage> {
    const run = (): Promise<LtiMessage> =>
      new Promise<LtiMessage>((resolve, reject) => {
        let done = false
        let connected = false
        const decoder = new FrameDecoder()
        const socket = this.connect()
        const finish = (err: Error | null, msg?: LtiMessage): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          this.close(socket, connected)
          if (err) reject(err)
          else resolve(msg as LtiMessage)
        }
        const timer = setTimeout(
          () => finish(new Error("terminal did not answer in time")),
          this.opts.probeTimeoutMs
        )
        socket.once("connect", () => {
          connected = true
          socket.write(encodeFrame(xml))
        })
        socket.on("data", (chunk: Buffer) => {
          let frames: string[]
          try {
            frames = decoder.push(chunk)
          } catch (err) {
            finish(err as Error)
            return
          }
          for (const frame of frames) {
            let msg: LtiMessage
            try {
              msg = parseLtiMessage(frame)
            } catch {
              continue
            }
            if (msg.kind === expect) finish(null, msg)
            else if (msg.kind === "error") {
              finish(new Error(`terminal error ${msg.errorCode ?? "?"}`))
            }
          }
        })
        socket.on("error", (err) => finish(err))
        socket.on("close", () => finish(new Error("connection closed")))
      })
    const next = this.probeChain.catch(() => {}).then(run)
    this.probeChain = next.catch(() => {})
    return next
  }
}

/** errorNotification → outcome. Exported for tests. */
export function mapErrorNotification(
  errorCode: string | undefined,
  errorText: string | undefined
): Omit<TerminalPaymentResult, "reference"> {
  const details = {
    ...(errorCode ? { errorCode } : {}),
    ...(errorText ? { errorText } : {}),
  }
  if (errorCode === LTI_ERROR_CUSTOMER_STOP) return { outcome: "aborted", ...details }
  if (errorCode === LTI_ERROR_CARD_NOT_DETECTED) return { outcome: "timeout", ...details }
  return { outcome: "error", ...details }
}
