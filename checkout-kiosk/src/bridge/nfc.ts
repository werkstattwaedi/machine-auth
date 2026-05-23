// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// nfc-pcsc ships no types; pull it in as `any` and narrow at usage sites.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NFC } = require("nfc-pcsc") as { NFC: new () => NfcInstance }

import type { NfcTagEvent } from "../types"

interface NfcReader {
  name: string
  autoProcessing: boolean
  transmit(apdu: Buffer, resLen: number): Promise<Buffer>
  on(event: "card", cb: (card: { uid: string }) => void): void
  on(event: "error", cb: (err: Error) => void): void
}

interface NfcInstance {
  on(event: "reader", cb: (reader: NfcReader) => void): void
  on(event: "error", cb: (err: Error) => void): void
}

export interface NfcOptions {
  onTag: (event: NfcTagEvent) => void
}

export function startNfc({ onTag }: NfcOptions): void {
  try {
    const nfc = new NFC()

    nfc.on("reader", (reader) => {
      console.log(`NFC reader connected: ${reader.name}`)
      // Disable nfc-pcsc's built-in auto-processing entirely
      reader.autoProcessing = false

      reader.on("card", async (card) => {
        try {
          const url = await readNdefUrl(reader)
          const event: NfcTagEvent = { physicalUid: card.uid }
          if (url) event.url = url
          console.log(`Tag read: uid=${card.uid}${url ? ` url=${url}` : ""}`)
          onTag(event)
        } catch (err) {
          console.error(
            "Failed to read tag:",
            err instanceof Error ? err.message : err
          )
        }
      })

      reader.on("error", (err) => {
        // Suppress noisy transmit errors from flaky contactless
        if (!err.message?.includes("transmitting")) {
          console.error(`Reader error: ${err.message}`)
        }
      })
    })

    nfc.on("error", (err) => {
      console.error(`NFC error: ${err.message}`)
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`NFC not available: ${msg}`)
    console.warn(
      "The app will work without NFC. Plug in a reader and restart to enable NFC."
    )
  }
}

// Read NDEF URI record from an NTAG424 DNA tag via ISO 7816-4 APDUs.
async function readNdefUrl(reader: NfcReader): Promise<string | null> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // Transmit with inter-APDU delay and SW check
  async function send(apdu: number[], resLen = 260): Promise<Buffer> {
    await delay(10)
    const resp = await reader.transmit(Buffer.from(apdu), resLen)
    const sw = resp.subarray(-2).readUInt16BE(0)
    if (sw !== 0x9000) throw new Error(`APDU failed: SW=${sw.toString(16)}`)
    return resp.subarray(0, -2)
  }

  // 1. SELECT NDEF application
  await send([
    0x00, 0xa4, 0x04, 0x00, 0x07, 0xd2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01,
    0x00,
  ])

  // 2. SELECT NDEF file (E104)
  await send([0x00, 0xa4, 0x00, 0x0c, 0x02, 0xe1, 0x04])

  // 3. READ BINARY — first 2 bytes = NLEN
  const nlenResp = await send([0x00, 0xb0, 0x00, 0x00, 0x02])
  const nlen = nlenResp.readUInt16BE(0)
  if (nlen === 0 || nlen > 1024) {
    throw new Error(`Invalid NLEN: ${nlen}`)
  }

  // 4. READ BINARY — NDEF message, chunked to stay within contactless frame
  // limits
  const chunkSize = 48
  const chunks: Buffer[] = []
  let remaining = nlen
  let offset = 2

  while (remaining > 0) {
    const len = Math.min(remaining, chunkSize)
    const chunk = await send(
      [0x00, 0xb0, (offset >> 8) & 0xff, offset & 0xff, len],
      len + 2
    )
    chunks.push(chunk)
    offset += len
    remaining -= len
  }

  return parseNdefUri(Buffer.concat(chunks))
}

// Parse an NDEF message containing a single URI record. Returns the full URL
// string or null.
function parseNdefUri(ndef: Buffer): string | null {
  if (ndef.length < 4) return null
  const header = ndef[0]
  const tnf = header & 0x07
  if (tnf !== 0x01) return null

  // Assumes Short Record (SR bit set) — always true for NTAG424 NDEF URLs.
  const typeLen = ndef[1]
  const payloadLen = ndef[2]
  const type = ndef[3]
  if (type !== 0x55) return null

  const payloadStart = 3 + typeLen
  if (payloadStart + payloadLen > ndef.length) return null
  const prefixCode = ndef[payloadStart]
  const rest = ndef
    .subarray(payloadStart + 1, payloadStart + payloadLen)
    .toString("utf8")

  const URI_PREFIXES = ["", "http://www.", "https://www.", "http://", "https://"]
  return (URI_PREFIXES[prefixCode] ?? "") + rest
}
