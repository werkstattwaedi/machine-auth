# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Brother PT-P950NW 32-byte status frame parser.

Python port of shared/src/printer/status.ts. Layout from Brother's
"Raster Command Reference for PT-P900/P900W/P950NW v1.02" §4 (`ESC i S`
reply). The printer pushes one of these unbidden when an error occurs
during a job — that reply path is how the gateway turns "label didn't
print" into a structured German error written back to the print job.

The German error strings are kept identical to the TypeScript original so
the admin UI surfaces the same wording regardless of which side parses.
"""

from typing import List, Optional, TypedDict

# Error-info byte 1 (offset 8).
_ERROR_INFO_1 = [
    (0x01, "Kein Band eingelegt"),
    (0x02, "Band zu Ende"),
    (0x04, "Schneider blockiert"),
    (0x08, "Akku schwach"),
    (0x10, "Netzteil-Fehler"),
    (0x40, "Falsches Band für gewählte Vorlage"),
    (0x80, "Kassette nicht oder falsch eingelegt"),
]

# Error-info byte 2 (offset 9).
_ERROR_INFO_2 = [
    (0x01, "Band ersetzen"),
    (0x02, "Speicher voll"),
    (0x04, "Kommunikationsfehler"),
    (0x10, "Bandende erreicht"),
    (0x20, "Druckkopf-Sensor defekt"),
    (0x40, "Deckel offen"),
    (0x80, "Drucker überhitzt"),
]


class PrinterStatus(TypedDict):
    media_width_mm: int
    media_type: int
    raw_status_type: int
    errors: List[str]


def parse_status(reply: bytes) -> Optional[PrinterStatus]:
    """Decode a 32-byte status reply.

    Returns ``None`` for buffers that don't look like status frames (wrong
    length, missing print-head mark) so callers can ignore stray bytes.
    """
    if len(reply) != 32:
        return None
    # The frame always opens with 0x80 (PrintHeadMark) + 0x20 (size = 32);
    # anything else is noise.
    if reply[0] != 0x80 or reply[1] != 0x20:
        return None

    errors: List[str] = []
    e1 = reply[8]
    e2 = reply[9]
    for bit, label in _ERROR_INFO_1:
        if e1 & bit:
            errors.append(label)
    for bit, label in _ERROR_INFO_2:
        if e2 & bit:
            errors.append(label)

    return PrinterStatus(
        media_width_mm=reply[10],
        media_type=reply[11],
        raw_status_type=reply[18],
        errors=errors,
    )
