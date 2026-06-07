// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { parseSunUrl, isNfcSupported, scanTagUrl } from "./use-tag-scan"

const SUN_URL =
  "https://id.werkstattwaedi.ch/?picc=AABBCCDDEEFF00112233445566778899&cmac=1122334455667788"

describe("parseSunUrl", () => {
  it("extracts picc + cmac from a SUN URL", () => {
    expect(parseSunUrl(SUN_URL)).to.deep.equal({
      picc: "AABBCCDDEEFF00112233445566778899",
      cmac: "1122334455667788",
    })
  })

  it("accepts uppercase param names", () => {
    expect(
      parseSunUrl("https://id.werkstattwaedi.ch/?PICC=aa&CMAC=bb"),
    ).to.deep.equal({ picc: "aa", cmac: "bb" })
  })

  it("throws on a URL missing cmac", () => {
    expect(() =>
      parseSunUrl("https://id.werkstattwaedi.ch/?picc=aa"),
    ).toThrow("Kein OWW-Tag erkannt")
  })

  it("throws on a non-URL string", () => {
    expect(() => parseSunUrl("not a url")).toThrow("Kein OWW-Tag erkannt")
  })
})

// --- Web NFC harness ----------------------------------------------------

type ReadingListener = (ev: { message: { records: unknown[] } }) => void

class FakeNDEFReader extends EventTarget {
  static last: FakeNDEFReader | undefined
  // scan() reads this at call time, so set it BEFORE scanTagUrl() constructs
  // the reader.
  static nextRejection: { name?: string } | undefined
  scanCalled = false
  readingListeners: ReadingListener[] = []
  errorListeners: Array<() => void> = []

  constructor() {
    super()
    FakeNDEFReader.last = this
  }

  addEventListener(type: string, cb: EventListenerOrEventListenerObject): void {
    if (type === "reading") {
      this.readingListeners.push(cb as unknown as ReadingListener)
    } else if (type === "readingerror") {
      this.errorListeners.push(cb as unknown as () => void)
    }
  }

  async scan(): Promise<void> {
    this.scanCalled = true
    if (FakeNDEFReader.nextRejection) throw FakeNDEFReader.nextRejection
  }

  emitReading(urls: string[]): void {
    this.emitRecords(urls.map((u) => ({ recordType: "url", text: u })))
  }

  emitRecords(specs: Array<{ recordType: string; text: string }>): void {
    const records = specs.map((s) => ({
      recordType: s.recordType,
      data: new DataView(new TextEncoder().encode(s.text).buffer),
    }))
    this.readingListeners.forEach((cb) => cb({ message: { records } }))
  }
}

function installNfc(): void {
  ;(globalThis as unknown as { NDEFReader: unknown }).NDEFReader =
    FakeNDEFReader
}
function removeNfc(): void {
  delete (globalThis as unknown as { NDEFReader?: unknown }).NDEFReader
}

describe("isNfcSupported", () => {
  afterEach(removeNfc)

  it("is false without NDEFReader", () => {
    removeNfc()
    expect(isNfcSupported()).to.equal(false)
  })

  it("is true with NDEFReader present", () => {
    installNfc()
    expect(isNfcSupported()).to.equal(true)
  })
})

describe("scanTagUrl", () => {
  beforeEach(() => {
    installNfc()
    FakeNDEFReader.last = undefined
    FakeNDEFReader.nextRejection = undefined
  })
  afterEach(removeNfc)

  it("rejects when NFC is unsupported", async () => {
    removeNfc()
    await expect(scanTagUrl()).rejects.toThrow(
      "nur in Chrome auf Android verfügbar",
    )
  })

  it("resolves picc/cmac from the first SUN url record", async () => {
    const p = scanTagUrl()
    // Wait a tick for scan() to be called + listeners attached.
    await Promise.resolve()
    FakeNDEFReader.last!.emitReading(["https://example.com/foo", SUN_URL])
    await expect(p).resolves.toEqual({
      picc: "AABBCCDDEEFF00112233445566778899",
      cmac: "1122334455667788",
    })
  })

  it("skips non-url/text records even if their bytes contain 'picc='", async () => {
    const p = scanTagUrl()
    await Promise.resolve()
    FakeNDEFReader.last!.emitRecords([
      { recordType: "mime", text: "junk picc=deadbeef cmac=00 junk" },
      { recordType: "url", text: SUN_URL },
    ])
    await expect(p).resolves.toEqual({
      picc: "AABBCCDDEEFF00112233445566778899",
      cmac: "1122334455667788",
    })
  })

  it("rejects a tag whose records carry no SUN params", async () => {
    const p = scanTagUrl()
    await Promise.resolve()
    FakeNDEFReader.last!.emitReading(["https://example.com/plain"])
    await expect(p).rejects.toThrow("Kein OWW-Tag erkannt")
  })

  it("maps a permission denial to a German message", async () => {
    FakeNDEFReader.nextRejection = { name: "NotAllowedError" }
    await expect(scanTagUrl()).rejects.toThrow("NFC-Zugriff verweigert")
  })
})
