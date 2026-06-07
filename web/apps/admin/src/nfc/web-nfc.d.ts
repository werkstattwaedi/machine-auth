// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// Minimal Web NFC (NDEFReader) typings — not yet in TypeScript's lib.dom.
// Chrome/Android only; feature-detected at runtime via `"NDEFReader" in window`.
// https://w3c.github.io/web-nfc/

interface NDEFRecord {
  readonly recordType: string
  readonly mediaType?: string
  readonly id?: string
  readonly encoding?: string
  readonly lang?: string
  readonly data?: DataView
}

interface NDEFMessage {
  readonly records: ReadonlyArray<NDEFRecord>
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string
  readonly message: NDEFMessage
}

interface NDEFReaderEventMap {
  reading: NDEFReadingEvent
  readingerror: Event
}

interface NDEFScanOptions {
  signal?: AbortSignal
}

declare class NDEFReader extends EventTarget {
  constructor()
  scan(options?: NDEFScanOptions): Promise<void>
  addEventListener<K extends keyof NDEFReaderEventMap>(
    type: K,
    listener: (this: NDEFReader, ev: NDEFReaderEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void
}

interface Window {
  NDEFReader?: typeof NDEFReader
}
