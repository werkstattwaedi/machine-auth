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
  on(
    event: "card" | "card.off",
    cb: (card: { uid?: string; atr?: Buffer }) => void
  ): void
  on(event: "error", cb: (err: Error) => void): void
  on(event: "end", cb: () => void): void
}

interface NfcInstance {
  on(event: "reader", cb: (reader: NfcReader) => void): void
  on(event: "error", cb: (err: Error) => void): void
}

export interface NfcOptions {
  onTag: (event: NfcTagEvent) => void
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function startNfc({ onTag }: NfcOptions): void {
  try {
    const nfc = new NFC()

    nfc.on("reader", (reader) => {
      console.log(`NFC reader connected: ${reader.name}`)
      // Disable nfc-pcsc's built-in auto-processing entirely
      reader.autoProcessing = false

      // Per-tap diagnostics (issue: reader beeps but kiosk doesn't react).
      // Sequence number correlates the card / card.off / read-phase lines of
      // one physical tap. Logged times: `@absolute` since reader connect AND
      // `+relative` since the tap's card event — the badges run in random-UID
      // mode, so the only way to tell "two physical taps" from "one hold
      // whose RF link dropped and re-detected" is the wall-clock gap between
      // one tap's card.off and the next tap's card event.
      const t0 = Date.now()
      const wall = () => `@${Date.now() - t0}ms`
      let tapCounter = 0
      let tapStart = 0
      let readInFlight = false
      // Tracks the RF field state so the read-retry loop can stop early once
      // the badge is gone (retrying against an empty field is pointless).
      let cardPresent = false

      reader.on("card", async (card) => {
        const tap = ++tapCounter
        tapStart = Date.now()
        const at = () => `+${Date.now() - tapStart}ms`
        const log = (msg: string) =>
          console.log(`[nfc] ${wall()} tap#${tap} ${at()} ${msg}`)
        log(
          `card detected (atr=${card.atr?.toString("hex") ?? "?"}` +
            `${readInFlight ? ", previous read still in flight!" : ""})`
        )
        readInFlight = true
        cardPresent = true
        let phase = "uid"
        let uid = ""
        try {
          uid = (await readUid(reader, log)) ?? card.uid ?? ""
          log(`uid read done: ${uid || "(none)"}`)
          phase = "ndef"
          // Retry only while THIS tap's card is still the live one: the
          // badge must be in the field AND no newer card event may have
          // fired. Without the tap check, a stale retry could transmit
          // against a newly placed card and dispatch its URL under this
          // tap's uid.
          const url = await readNdefUrlWithRetry(
            reader,
            log,
            () => cardPresent && tapCounter === tap
          )
          const event: NfcTagEvent = { physicalUid: uid }
          if (url) event.url = url
          log(`tag read OK: uid=${uid || "?"}${url ? ` url=${url}` : " (no url!)"}`)
          onTag(event)
        } catch (err) {
          log(
            `READ FAILED in phase=${phase}: ` +
              (err instanceof Error ? err.message : String(err))
          )
          // Still dispatch (without url): the reader beeped at detection, so
          // the user expects a reaction. The web app surfaces a "Badge bitte
          // nochmals auflegen" toast for url-less events — without this the
          // most common failure (badge lifted right after the beep, killing
          // the APDU sequence mid-read) was completely silent.
          onTag({ physicalUid: uid })
        } finally {
          readInFlight = false
        }
      })

      // Fires when the card leaves the RF field. Logged so a failed read can
      // be correlated with an early badge removal (the reader beeps on
      // detection, but the APDU sequence still needs the card afterwards).
      reader.on("card.off", () => {
        cardPresent = false
        const since = tapStart ? `+${Date.now() - tapStart}ms` : "?"
        console.log(
          `[nfc] ${wall()} tap#${tapCounter} ${since} card left the field`
        )
      })

      reader.on("error", (err) => {
        // Log everything while we chase the silent-tap issue; transmit noise
        // from a flaky contactless link is exactly what we're looking for.
        console.error(`[nfc] ${wall()} reader error: ${err.message}`)
      })

      reader.on("end", () => {
        console.warn(`[nfc] reader disconnected: ${reader.name}`)
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

// Read the card UID via the PC/SC GET DATA pseudo-APDU (FF CA 00 00 00).
// Returns lowercase hex, or undefined if the reader/card doesn't answer.
async function readUid(
  reader: NfcReader,
  log: (msg: string) => void
): Promise<string | undefined> {
  try {
    const resp = await reader.transmit(
      Buffer.from([0xff, 0xca, 0x00, 0x00, 0x00]),
      16
    )
    if (resp.length < 2) {
      log(`uid: short response (${resp.length} bytes)`)
      return undefined
    }
    const sw = resp.subarray(-2).readUInt16BE(0)
    if (sw !== 0x9000) {
      log(`uid: SW=${sw.toString(16)}`)
      return undefined
    }
    return resp.subarray(0, -2).toString("hex")
  } catch (err) {
    log(
      `uid: transmit failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return undefined
  }
}

// The NDEF read fails transiently in two ways (tap traces 2026-06-10):
//   - SW=6985 on the first READ BINARY while the badge sits firmly on the
//     reader — a known ACR1252/NTAG424 activation quirk that the UID-read
//     warm-up reduces but doesn't eliminate (~40% of holds in testing).
//   - A dead transmit when the badge leaves the field mid-sequence.
// Both recover by simply re-running the sequence from SELECT (6985 implies
// the selection state was lost), as long as the badge is still in the field.
async function readNdefUrlWithRetry(
  reader: NfcReader,
  log: (msg: string) => void,
  stillCurrent: () => boolean
): Promise<string | null> {
  const MAX_ATTEMPTS = 4
  for (let attempt = 1; ; attempt++) {
    try {
      return await readNdefUrl(reader, log)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt >= MAX_ATTEMPTS) throw err
      if (!stillCurrent()) {
        throw new Error(`${msg} (badge left the field, not retrying)`)
      }
      log(`ndef attempt ${attempt}/${MAX_ATTEMPTS} failed (${msg}) — retrying`)
      await delay(30)
    }
  }
}

// Read NDEF URI record from an NTAG424 DNA tag via ISO 7816-4 APDUs.
async function readNdefUrl(
  reader: NfcReader,
  log: (msg: string) => void
): Promise<string | null> {
  // Transmit with inter-APDU delay and SW check. `step` names the APDU so a
  // failure pinpoints how far into the sequence the card survived.
  //
  // The delay used to be 10ms; the tap traces showed the whole read taking
  // ~200ms while quick taps leave the field after ~350ms — every ms of
  // artificial delay widens the window where a lifted badge kills the read.
  async function send(
    step: string,
    apdu: number[],
    resLen = 260
  ): Promise<Buffer> {
    await delay(2)
    let resp: Buffer
    try {
      resp = await reader.transmit(Buffer.from(apdu), resLen)
    } catch (err) {
      throw new Error(
        `${step}: transmit failed: ` +
          (err instanceof Error ? err.message : String(err))
      )
    }
    // A degenerate (<2 byte) response would make readUInt16BE throw a bare
    // RangeError without the step context — surface it as a normal APDU
    // failure so the retry loop and logs treat it like any other flake.
    if (resp.length < 2) {
      throw new Error(`${step}: short response (${resp.length} bytes)`)
    }
    const sw = resp.subarray(-2).readUInt16BE(0)
    if (sw !== 0x9000) throw new Error(`${step}: APDU failed: SW=${sw.toString(16)}`)
    return resp.subarray(0, -2)
  }

  // 1. SELECT NDEF application
  await send("select-app", [
    0x00, 0xa4, 0x04, 0x00, 0x07, 0xd2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01,
    0x00,
  ])

  // 2. SELECT NDEF file (E104)
  await send("select-file", [0x00, 0xa4, 0x00, 0x0c, 0x02, 0xe1, 0x04])

  // READ BINARY helper — reads `length` bytes from `offset`, chunked to stay
  // within contactless frame limits. The NTAG424 DNA advertises FSC=128
  // (FSCI 7), so 120 bytes of data + SW fits one ISO-DEP frame — the old
  // 48-byte chunking split the 86-byte NDEF message into two round-trips.
  const chunkSize = 120
  async function readBytes(
    step: string,
    offset: number,
    length: number
  ): Promise<Buffer> {
    const chunks: Buffer[] = []
    let remaining = length
    let off = offset
    while (remaining > 0) {
      const len = Math.min(remaining, chunkSize)
      chunks.push(
        await send(
          `${step}@${off}`,
          [0x00, 0xb0, (off >> 8) & 0xff, off & 0xff, len],
          len + 2
        )
      )
      off += len
      remaining -= len
    }
    return Buffer.concat(chunks)
  }

  // 3. Read NLEN (2 bytes) + the short-record header (4 bytes) in a single
  // APDU — they're contiguous at offset 0, and saving a round-trip narrows
  // the lifted-badge window.
  const head = await readBytes("read-head", 0, 6)
  const nlen = head.readUInt16BE(0)
  if (nlen === 0 || nlen > 1024) {
    throw new Error(`Invalid NLEN: ${nlen}`)
  }

  // 4. Read by the record's own declared length rather than trusting NLEN.
  // The personalize off-by-one fixed in #410 means freshly written tags now
  // have a correct NLEN, but deriving the length from the short-record header
  // keeps this robust for any tag written before that fix — whose NLEN is one
  // byte short and would otherwise truncate the final CMAC character.
  const hdr = head.subarray(2)
  const typeLen = hdr[1]
  const payloadLen = hdr[2]
  const recordLen = 3 + typeLen + payloadLen
  const total = Math.min(Math.max(nlen, recordLen), 1024)
  log(`ndef: nlen=${nlen} recordLen=${recordLen} → reading ${total} bytes`)

  // 5. Read the rest of the message (its first 4 bytes are already in hand
  // from the header read above).
  const rest = await readBytes("read-msg", 6, total - 4)
  const message = Buffer.concat([hdr, rest])
  return parseNdefUri(message)
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
