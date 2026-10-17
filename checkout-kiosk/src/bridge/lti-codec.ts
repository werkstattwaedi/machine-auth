// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Wire format of Wallee's Local Till Interface (LTI 2.54) as the A35 speaks
// it on TCP port 50000: every message is a 4-byte unsigned big-endian length
// of the UTF-8 XML body, followed by that body. The root element is the
// message type (`vcs-pos:financialTrxRequest`, `vcs-device:trxStartNotification`
// …). Pure functions only, so the codec is testable without a socket.
//
// We parse into a small typed union instead of validating against the XSDs:
// the terminal is a known peer, and an element we don't know must not break
// a running payment — it becomes `{ kind: "unknown" }` and is logged.

import { XMLParser, XMLValidator } from "fast-xml-parser"

const POS_NS = "http://www.vibbek.com/pos"
const DEVICE_NS = "http://www.vibbek.com/device"
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/**
 * Upper bound for one frame. Real frames are well under 2 KiB (a receipt
 * printerNotification is the largest); a length beyond this means the
 * stream is out of sync or the peer isn't a terminal, and buffering it would
 * only let a LAN peer make the kiosk allocate unbounded memory.
 */
export const MAX_FRAME_BYTES = 1024 * 1024

export class LtiFramingError extends Error {}

/** Frame one XML message for the wire. */
export function encodeFrame(xml: string): Buffer {
  const body = Buffer.from(xml, "utf8")
  if (body.length > MAX_FRAME_BYTES) {
    throw new LtiFramingError(`frame of ${body.length} bytes exceeds ${MAX_FRAME_BYTES}`)
  }
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length)
  return Buffer.concat([header, body])
}

/**
 * Streaming decoder: TCP delivers frames split across chunks or several in
 * one chunk (the A35 happens to send one frame per chunk, but nothing
 * guarantees it). Feed every chunk to `push`; it returns the complete XML
 * bodies in order and keeps the remainder buffered.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const frames: string[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length > MAX_FRAME_BYTES) {
        // Unrecoverable: we can't find the next frame boundary.
        this.buffer = Buffer.alloc(0)
        throw new LtiFramingError(`announced frame of ${length} bytes exceeds ${MAX_FRAME_BYTES}`)
      }
      if (this.buffer.length < 4 + length) break
      frames.push(this.buffer.subarray(4, 4 + length).toString("utf8"))
      this.buffer = this.buffer.subarray(4 + length)
    }
    return frames
  }

  /** Bytes of an incomplete frame still waiting for the rest. */
  get pending(): number {
    return this.buffer.length
  }
}

// ── Builders (till → terminal) ─────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Notifications we want during a payment (spec §6.1.1): card entry, card
 * removal, transaction start/end/abort and QR code scan (TWINT) —
 * 0x00003F, base64 "AAA/".
 */
export const TRX_INFO_ALL_EVENTS = "AAA/"

/** ISO 4217 numeric code for CHF. */
export const CURRENCY_CHF = 756

export interface FinancialTrxRequestInput {
  posId: string
  amountRappen: number
  merchantReference: string
}

/**
 * A purchase (transactionType 0) in CHF. Partial approvals and DCC are off;
 * the result screens stay on so the customer sees the outcome on the
 * terminal too. No `trxSyncNumber`: recovery is the backend's job, and sync
 * numbers would force till-triggered final balances (ADR-0048).
 */
export function financialTrxRequest(input: FinancialTrxRequestInput): string {
  return (
    `${XML_HEADER}<vcs-pos:financialTrxRequest xmlns:vcs-pos="${POS_NS}">` +
    `<posId>${escapeXml(input.posId)}</posId>` +
    `<trxData>` +
    `<amount>${input.amountRappen}</amount>` +
    `<currency>${CURRENCY_CHF}</currency>` +
    `<transactionType>0</transactionType>` +
    `<partialApprovalCap>0</partialApprovalCap>` +
    `<noDCC>true</noDCC>` +
    `<merchantReference>${escapeXml(input.merchantReference)}</merchantReference>` +
    `</trxData>` +
    `<trxInfo>${TRX_INFO_ALL_EVENTS}</trxInfo>` +
    `<showTrxResultScreens>true</showTrxResultScreens>` +
    `</vcs-pos:financialTrxRequest>`
  )
}

/**
 * Ask the terminal to stop waiting for a card. It has no effect once the
 * card is read (spec §6.18); `silentAbort` skips the terminal's own abort
 * screen, since the kiosk shows its own.
 */
export function abortCardEntryNotification(silentAbort = true): string {
  return (
    `${XML_HEADER}<vcs-device:abortCardEntryNotification xmlns:vcs-device="${DEVICE_NS}">` +
    `<silentAbort>${silentAbort ? "true" : "false"}</silentAbort>` +
    `</vcs-device:abortCardEntryNotification>`
  )
}

export function pingRequest(): string {
  return `${XML_HEADER}<vcs-pos:pingRequest xmlns:vcs-pos="${POS_NS}"/>`
}

export function pinpadInformationRequest(posId: string): string {
  return (
    `${XML_HEADER}<vcs-pos:pinpadInformationRequest xmlns:vcs-pos="${POS_NS}">` +
    `<posId>${escapeXml(posId)}</posId>` +
    `</vcs-pos:pinpadInformationRequest>`
  )
}

// ── Parser (terminal → till) ───────────────────────────────────────

export type LtiDisplayType = "CARDHOLDER" | "ATTENDANT"

export type LtiMessage =
  | { kind: "trxStart" }
  /** cardEntryMode: 0 magstripe, 1 chip, 2 contactless (spec §6.25.1). */
  | { kind: "cardEntry"; cardEntryMode?: number }
  /** A TWINT (or other QR) code was scanned — the QR counterpart of cardEntry. */
  | { kind: "qrCodeScan" }
  | { kind: "cardRemoval" }
  | { kind: "trxEnd" }
  | { kind: "trxAbort" }
  | { kind: "display"; displayType: LtiDisplayType; lines: string[] }
  /** Receipt text; the Quittung is our own PDF, so it's only diagnostic. */
  | { kind: "printer"; receipt: "merchant" | "cardholder" | "other" }
  | {
      kind: "financialTrxResponse"
      trxResult: number
      amountAuth?: number
      amountAuthCurr?: number
      ep2AuthResponseCode?: string
      cardAppLabel?: string
      paymentEntryMethod?: string
      merchantReference?: string
    }
  | { kind: "error"; errorCode?: string; errorText?: string; merchantReference?: string }
  | { kind: "pingResponse"; server?: string }
  | {
      kind: "pinpadInformation"
      terminalId?: string
      hardwareType?: string
      softwareVersion?: string
    }
  /** Terminal asks the attendant to confirm (reversals). We never answer it. */
  | { kind: "confirmationRequest"; lines: string[] }
  // Till → terminal. Parsed so the simulator (scripts/lti-sim.ts) speaks
  // the same codec; the till side never receives these.
  | { kind: "financialTrxRequest"; posId?: string; amount?: number; merchantReference?: string }
  | { kind: "abortCardEntry"; silentAbort: boolean }
  | { kind: "pingRequest" }
  | { kind: "pinpadInformationRequest"; posId?: string }
  | { kind: "unknown"; root: string }

export class LtiParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // The root element name is the message type; the prefix only tells
  // vcs-pos from vcs-device, which the name already implies.
  removeNSPrefix: true,
  // Keep every value a string: "00" response codes and terminal ids must
  // not become numbers.
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => name === "line",
})

type XmlNode = Record<string, unknown>

function text(node: unknown, key: string): string | undefined {
  if (node === null || typeof node !== "object") return undefined
  const value = (node as XmlNode)[key]
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return undefined
}

function int(node: unknown, key: string): number | undefined {
  const raw = text(node, key)
  if (raw === undefined || raw.trim() === "") return undefined
  const n = Number(raw)
  return Number.isInteger(n) ? n : undefined
}

function lines(node: unknown): string[] {
  if (node === null || typeof node !== "object") return []
  const display = (node as XmlNode).display
  if (display === null || typeof display !== "object") return []
  const raw = (display as XmlNode).line
  if (!Array.isArray(raw)) return []
  return raw.map((l) => (typeof l === "string" ? l : typeof l === "number" ? String(l) : ""))
}

/** Parse one frame body. Throws `LtiParseError` on malformed XML. */
export function parseLtiMessage(xml: string): LtiMessage {
  const valid = XMLValidator.validate(xml)
  if (valid !== true) {
    throw new LtiParseError(`malformed LTI frame: ${valid.err.msg}`)
  }
  const doc = parser.parse(xml) as XmlNode
  const roots = Object.keys(doc)
  if (roots.length !== 1) {
    throw new LtiParseError(`expected one root element, got ${roots.length}`)
  }
  const root = roots[0]
  const body = doc[root]

  switch (root) {
    case "trxStartNotification":
      return { kind: "trxStart" }
    case "cardEntryNotification":
      return { kind: "cardEntry", cardEntryMode: int(body, "cardEntryMode") }
    case "qrCodeScanNotification":
      return { kind: "qrCodeScan" }
    case "cardRemovalNotification":
      return { kind: "cardRemoval" }
    case "trxEndNotification":
      return { kind: "trxEnd" }
    case "trxAbortNotification":
      return { kind: "trxAbort" }
    case "displayNotification": {
      const type = text(body, "@_displayType")
      return {
        kind: "display",
        displayType: type === "ATTENDANT" ? "ATTENDANT" : "CARDHOLDER",
        lines: lines(body),
      }
    }
    case "printerNotification": {
      const node = (body ?? {}) as XmlNode
      const receipt =
        "merchantReceipt" in node ? "merchant" : "cardholderReceipt" in node ? "cardholder" : "other"
      return { kind: "printer", receipt }
    }
    case "financialTrxResponse": {
      const trxResult = int(body, "trxResult")
      if (trxResult === undefined) {
        throw new LtiParseError("financialTrxResponse without trxResult")
      }
      return {
        kind: "financialTrxResponse",
        trxResult,
        amountAuth: int(body, "amountAuth"),
        amountAuthCurr: int(body, "amountAuthCurr"),
        ep2AuthResponseCode: text(body, "ep2AuthResponseCode"),
        cardAppLabel: text(body, "cardAppLabel") || undefined,
        paymentEntryMethod: text(body, "paymentEntryMethod") || undefined,
        merchantReference: text(body, "merchantReference") || undefined,
      }
    }
    case "errorNotification":
      return {
        kind: "error",
        errorCode: text(body, "errorCode") || undefined,
        errorText: text(body, "errorText") || undefined,
        merchantReference: text(body, "merchantReference") || undefined,
      }
    case "pingResponse":
      return { kind: "pingResponse", server: text(body, "server") || undefined }
    case "pinpadInformationResponse":
      return {
        kind: "pinpadInformation",
        terminalId: text(body, "terminalId") || undefined,
        hardwareType: text(body, "hardwareType") || undefined,
        softwareVersion: text(body, "vpjSoftwareVersion") || undefined,
      }
    case "confirmationRequest":
      return { kind: "confirmationRequest", lines: lines(body) }
    case "financialTrxRequest": {
      const trxData = body !== null && typeof body === "object" ? (body as XmlNode).trxData : undefined
      return {
        kind: "financialTrxRequest",
        posId: text(body, "posId") || undefined,
        amount: int(trxData, "amount"),
        merchantReference: text(trxData, "merchantReference") || undefined,
      }
    }
    case "abortCardEntryNotification":
      return { kind: "abortCardEntry", silentAbort: text(body, "silentAbort") === "true" }
    case "pingRequest":
      return { kind: "pingRequest" }
    case "pinpadInformationRequest":
      return { kind: "pinpadInformationRequest", posId: text(body, "posId") || undefined }
    default:
      return { kind: "unknown", root }
  }
}
