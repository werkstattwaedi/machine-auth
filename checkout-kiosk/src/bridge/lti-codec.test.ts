// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  abortCardEntryNotification,
  encodeFrame,
  financialTrxRequest,
  FrameDecoder,
  LtiFramingError,
  LtiParseError,
  MAX_FRAME_BYTES,
  parseLtiMessage,
  pingRequest,
  pinpadInformationRequest,
} from "./lti-codec.ts"

interface Frame {
  dir: ">>>" | "<<<"
  xml: string
}

// Fixture format: '--- <<<' / '--- >>>' marker lines, each followed by one
// frame body verbatim (receipts span several lines).
function loadFixture(name: string): Frame[] {
  const text = readFileSync(join(__dirname, "fixtures", name), "utf8")
  const frames: Frame[] = []
  const parts = text.split(/^--- (<<<|>>>)\n/m)
  for (let i = 1; i < parts.length; i += 2) {
    frames.push({ dir: parts[i] as Frame["dir"], xml: parts[i + 1].replace(/\n$/, "") })
  }
  return frames
}

const fromTerminal = (name: string) =>
  loadFixture(name)
    .filter((f) => f.dir === "<<<")
    .map((f) => parseLtiMessage(f.xml))

// ── framing ────────────────────────────────────────────────────────

test("encodeFrame prefixes the UTF-8 byte length big-endian", () => {
  const xml = pingRequest()
  const frame = encodeFrame(xml)
  // The captured ping request is 119 bytes: 00 00 00 77.
  assert.deepEqual([...frame.subarray(0, 4)], [0, 0, 0, 0x77])
  assert.equal(frame.subarray(4).toString("utf8"), xml)
  // Multi-byte characters count as bytes, not chars.
  assert.equal(encodeFrame("ä").readUInt32BE(0), 2)
})

test("decoder reassembles a frame split across chunks, even inside the header", () => {
  const frame = encodeFrame("<a>Wädenswil</a>")
  const decoder = new FrameDecoder()
  const out: string[] = []
  for (let i = 0; i < frame.length; i++) out.push(...decoder.push(frame.subarray(i, i + 1)))
  assert.deepEqual(out, ["<a>Wädenswil</a>"])
  assert.equal(decoder.pending, 0)
})

test("decoder splits merged frames and keeps a trailing partial one", () => {
  const a = encodeFrame("<a/>")
  const b = encodeFrame("<b/>")
  const c = encodeFrame("<c/>")
  const decoder = new FrameDecoder()
  assert.deepEqual(decoder.push(Buffer.concat([a, b, c.subarray(0, 6)])), ["<a/>", "<b/>"])
  assert.equal(decoder.pending, 6)
  assert.deepEqual(decoder.push(c.subarray(6)), ["<c/>"])
})

test("decoder handles an empty frame", () => {
  assert.deepEqual(new FrameDecoder().push(Buffer.from([0, 0, 0, 0])), [""])
})

test("decoder rejects an oversized frame from its header alone", () => {
  const header = Buffer.alloc(4)
  header.writeUInt32BE(MAX_FRAME_BYTES + 1)
  assert.throws(() => new FrameDecoder().push(header), LtiFramingError)
  // A stray HTTP request (not a terminal) reads as a giant length too.
  assert.throws(() => new FrameDecoder().push(Buffer.from("GET / HTTP/1.1\r\n")), LtiFramingError)
})

test("decoder accepts a frame of exactly the limit", () => {
  const body = Buffer.alloc(MAX_FRAME_BYTES, 0x61)
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length)
  const out = new FrameDecoder().push(Buffer.concat([header, body]))
  assert.equal(out[0].length, MAX_FRAME_BYTES)
})

test("encodeFrame refuses an oversized body", () => {
  assert.throws(() => encodeFrame("a".repeat(MAX_FRAME_BYTES + 1)), LtiFramingError)
})

// ── builders ───────────────────────────────────────────────────────

test("financialTrxRequest matches what the spike sent the real terminal", () => {
  const [sent] = loadFixture("approved-card.lti")
  assert.equal(sent.dir, ">>>")
  assert.equal(
    financialTrxRequest({ posId: "KIOSK-01", amountRappen: 300, merchantReference: "S-FixtureCheckout0001-1" }),
    sent.xml
  )
})

test("financialTrxRequest escapes XML in the reference", () => {
  const xml = financialTrxRequest({ posId: "P<1>", amountRappen: 1, merchantReference: 'a&b"' })
  const msg = parseLtiMessage(xml)
  assert.deepEqual(msg, { kind: "financialTrxRequest", posId: "P<1>", amount: 1, merchantReference: 'a&b"' })
})

test("abort, ping and pinpad requests match the captured frames", () => {
  const abortSent = loadFixture("abort-before-card.lti").filter((f) => f.dir === ">>>")[1]
  assert.equal(abortCardEntryNotification(true), abortSent.xml)
  assert.equal(pingRequest(), loadFixture("ping.lti")[0].xml)
  assert.equal(pinpadInformationRequest("KIOSK-01"), loadFixture("pinpad-information.lti")[0].xml)
  assert.deepEqual(parseLtiMessage(abortCardEntryNotification(false)), {
    kind: "abortCardEntry",
    silentAbort: false,
  })
})

// ── parsing captured transcripts ───────────────────────────────────

test("approved card payment", () => {
  const msgs = fromTerminal("approved-card.lti")
  assert.deepEqual(
    msgs.map((m) => m.kind),
    ["trxStart", "cardEntry", "cardRemoval", "display", "display", "printer", "printer", "trxEnd", "financialTrxResponse"]
  )
  assert.deepEqual(msgs[1], { kind: "cardEntry", cardEntryMode: 2 })
  assert.deepEqual(msgs[3], { kind: "display", displayType: "CARDHOLDER", lines: ["", "Verarbeitung OK"] })
  assert.deepEqual(msgs[4], { kind: "display", displayType: "ATTENDANT", lines: ["Verarbeitung OK"] })
  assert.deepEqual(msgs[5], { kind: "printer", receipt: "merchant" })
  assert.deepEqual(msgs[6], { kind: "printer", receipt: "cardholder" })
  assert.deepEqual(msgs[8], {
    kind: "financialTrxResponse",
    trxResult: 0,
    amountAuth: 300,
    amountAuthCurr: 756,
    ep2AuthResponseCode: "00",
    cardAppLabel: "MastercardCtless",
    paymentEntryMethod: "CTLS",
    merchantReference: "S-FixtureCheckout0001-1",
  })
})

test("declined card payment", () => {
  const msgs = fromTerminal("declined-card.lti")
  const displays = msgs.filter((m) => m.kind === "display")
  assert.deepEqual(displays[0], { kind: "display", displayType: "CARDHOLDER", lines: ["CHF 0.00", "Höchstbetrag"] })
  const last = msgs.at(-1)
  assert.equal(last?.kind, "financialTrxResponse")
  if (last?.kind !== "financialTrxResponse") return
  assert.equal(last.trxResult, 1)
  assert.equal(last.amountAuth, 0)
  assert.equal(last.ep2AuthResponseCode, "01")
})

test("abort before the card", () => {
  assert.deepEqual(fromTerminal("abort-before-card.lti"), [
    { kind: "trxStart" },
    { kind: "trxAbort" },
    {
      kind: "error",
      errorCode: "TRM.PT.0002",
      errorText: "Stopp des Kunden",
      merchantReference: "S-FixtureCheckout0003-1",
    },
  ])
})

test("TWINT: a QR scan instead of a card entry", () => {
  const msgs = fromTerminal("twint-approved.lti")
  assert.deepEqual(msgs[1], { kind: "qrCodeScan" })
  assert.ok(!msgs.some((m) => m.kind === "cardEntry" || m.kind === "cardRemoval"))
  const last = msgs.at(-1)
  assert.equal(last?.kind === "financialTrxResponse" && last.cardAppLabel, "TWINT")
  assert.equal(last?.kind === "financialTrxResponse" && last.paymentEntryMethod, "QR")
})

test("no card / unknown application ends in an errorNotification without text", () => {
  const msgs = fromTerminal("no-card-unknown-application.lti")
  assert.deepEqual(msgs.at(-1), {
    kind: "error",
    errorCode: "TRM.PT.0500",
    errorText: undefined,
    merchantReference: "S-FixtureCheckout0005-1",
  })
})

test("ping and pinpad information", () => {
  assert.deepEqual(fromTerminal("ping.lti"), [
    { kind: "display", displayType: "ATTENDANT", lines: ["Connection OK"] },
    { kind: "pingResponse", server: "terminal-backend.example.invalid" },
  ])
  assert.deepEqual(fromTerminal("pinpad-information.lti"), [
    { kind: "pinpadInformation", terminalId: "12345678", hardwareType: "A35", softwareVersion: "1.2.54.1" },
  ])
})

test("confirmationRequest (reversal prompt) parses to its display lines", () => {
  const xml =
    '<?xml version="1.0" encoding="utf-8"?><vcs-device:confirmationRequest displayType="ATTENDANT" xmlns:vcs-device="http://www.vibbek.com/device">' +
    "<display><line>Debit Mastercard</line><line>Storno</line><line>CHF 3.00 OK?</line></display>" +
    "<timeout>30</timeout><timeoutReminder>30</timeoutReminder></vcs-device:confirmationRequest>"
  assert.deepEqual(parseLtiMessage(xml), {
    kind: "confirmationRequest",
    lines: ["Debit Mastercard", "Storno", "CHF 3.00 OK?"],
  })
})

test("unknown messages and malformed XML", () => {
  assert.deepEqual(
    parseLtiMessage('<vcs-pos:somethingNewResponse xmlns:vcs-pos="http://www.vibbek.com/pos"/>'),
    { kind: "unknown", root: "somethingNewResponse" }
  )
  assert.throws(() => parseLtiMessage("<a><b></a>"), LtiParseError)
  assert.throws(() => parseLtiMessage("not xml"), LtiParseError)
  assert.throws(
    () => parseLtiMessage('<vcs-pos:financialTrxResponse xmlns:vcs-pos="http://www.vibbek.com/pos"/>'),
    LtiParseError
  )
})
