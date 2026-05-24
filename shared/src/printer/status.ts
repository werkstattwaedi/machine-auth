// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * 32-byte status frame returned by the PT-P950NW (and other current
 * Brother printers). Layout from Brother's "Raster Command Reference
 * for PT-P900/P900W/P950NW v1.02" §4 (`ESC i S` reply) and the
 * matching section of the P-touch Template Command Reference.
 *
 * The printer pushes one of these unbidden when an error occurs during
 * a print job — that's the reply path our bridge exploits to translate
 * "label didn't print" into a structured German toast.
 */

export type PrinterStatusType =
  | "reply"
  | "printing-complete"
  | "error"
  | "interface-mode-finished"
  | "power-off"
  | "notification"
  | "phase-change"
  | "unknown"

export interface PrinterStatus {
  /** Tape width in mm reported by the printer (from the loaded
   *  cartridge). 0 when no media is loaded. */
  mediaWidthMm: number
  /** Media type code: 0x01 laminated TZe, 0x03 non-laminated,
   *  0x11 heat-shrink, etc. 0x00 when no media. */
  mediaType: number
  /** High-level status type. `"error"` means at least one error bit
   *  in `errors[]` is set; treat as a hard reject of the job. */
  statusType: PrinterStatusType
  /** Human-readable German error labels, one per asserted bit. Empty
   *  array when the printer's happy. */
  errors: string[]
  /** Raw status type byte (0x00-0xFF) for debugging / telemetry. */
  rawStatusType: number
}

// Error-info byte 1 (offset 8). Bits per the spec.
const ERROR_INFO_1: Array<[number, string]> = [
  [0x01, "Kein Band eingelegt"],
  [0x02, "Band zu Ende"],
  [0x04, "Schneider blockiert"],
  [0x08, "Akku schwach"],
  [0x10, "Netzteil-Fehler"],
  [0x40, "Falsches Band für gewählte Vorlage"],
  [0x80, "Kassette nicht oder falsch eingelegt"],
]

// Error-info byte 2 (offset 9).
const ERROR_INFO_2: Array<[number, string]> = [
  [0x01, "Band ersetzen"],
  [0x02, "Speicher voll"],
  [0x04, "Kommunikationsfehler"],
  [0x10, "Bandende erreicht"],
  [0x20, "Druckkopf-Sensor defekt"],
  [0x40, "Deckel offen"],
  [0x80, "Drucker überhitzt"],
]

function decodeStatusType(b: number): PrinterStatusType {
  switch (b) {
    case 0x00:
      return "reply"
    case 0x01:
      return "printing-complete"
    case 0x02:
      return "error"
    case 0x03:
      return "interface-mode-finished"
    case 0x04:
      return "power-off"
    case 0x05:
      return "notification"
    case 0x06:
      return "phase-change"
    default:
      return "unknown"
  }
}

/**
 * Decode a 32-byte status reply. Returns `null` for buffers that
 * don't look like status frames (wrong length, missing print-head
 * mark) so callers can ignore stray bytes.
 */
export function parseStatus(reply: Uint8Array): PrinterStatus | null {
  if (reply.length !== 32) return null
  // The frame always opens with 0x80 (PrintHeadMark) + 0x20 (size = 32);
  // anything else is noise.
  if (reply[0] !== 0x80 || reply[1] !== 0x20) return null

  const errors: string[] = []
  const e1 = reply[8]
  const e2 = reply[9]
  for (const [bit, label] of ERROR_INFO_1) {
    if (e1 & bit) errors.push(label)
  }
  for (const [bit, label] of ERROR_INFO_2) {
    if (e2 & bit) errors.push(label)
  }

  return {
    mediaWidthMm: reply[10],
    mediaType: reply[11],
    statusType: decodeStatusType(reply[18]),
    errors,
    rawStatusType: reply[18],
  }
}
