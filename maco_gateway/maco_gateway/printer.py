# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""TCP forwarder to a Brother PT-P950NW label printer.

Python/asyncio port of checkout-kiosk/src/bridge/printer.ts. The printer
speaks the raw Brother raster protocol on TCP :9100 — the bytes are built
client-side by the admin web app (`buildRasterJob`) and arrive here
base64-encoded in a print-job doc. This module only opens the socket,
writes, and interprets any status reply.
"""

import asyncio
import logging
from typing import Optional, Tuple

from .printer_status import parse_status

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_S = 3.0
# PT-P950NW keeps TCP connections open expecting more jobs and never sends
# FIN after a write. Linger briefly after writing so the OS flushes and so we
# can catch a status frame (the printer pushes a 32-byte frame within ~1s on
# error: cover open, wrong tape, no media), then force-close.
POST_WRITE_LINGER_S = 1.5
DEFAULT_PORT = 9100


class PrinterError(Exception):
    """Raised when the printer is unreachable or rejects the job.

    The message is a human-readable German string suitable for surfacing
    straight back to the admin UI via the print-job doc.
    """


def parse_printer_endpoint(raw: Optional[str]) -> Optional[Tuple[str, int]]:
    """Parse a ``host`` / ``host:port`` string. Returns ``None`` when unset."""
    if not raw:
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None
    if ":" in trimmed:
        host, _, port = trimmed.rpartition(":")
        if not host:
            raise ValueError(f"Invalid printer host: {raw}")
        return host, int(port)
    return trimmed, DEFAULT_PORT


async def send_to_printer(host: str, port: int, data: bytes) -> int:
    """Send a raster job to the printer over TCP.

    Resolves with the number of bytes written once the OS has accepted the
    write and the linger window has elapsed. Raises :class:`PrinterError` on
    connect timeout, socket error, or a status frame carrying an error bit.
    """
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=CONNECT_TIMEOUT_S
        )
    except asyncio.TimeoutError as exc:
        raise PrinterError(f"Drucker nicht erreichbar ({host}:{port})") from exc
    except OSError as exc:
        raise PrinterError(f"Drucker nicht erreichbar ({host}:{port})") from exc

    try:
        writer.write(data)
        await writer.drain()

        # Read whatever the printer sends within the linger window. A happy
        # job → silence (we time out and close). An error → one or more
        # 32-byte frames.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + POST_WRITE_LINGER_S
        incoming = b""
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            try:
                chunk = await asyncio.wait_for(reader.read(4096), timeout=remaining)
            except asyncio.TimeoutError:
                break
            if not chunk:
                break
            incoming += chunk

        # The printer sometimes streams multiple 32-byte frames (e.g.
        # phase-change → error). Scan each window for an error frame so we
        # report the actual problem, not "phase change" noise.
        for off in range(0, len(incoming) - 31, 32):
            status = parse_status(incoming[off : off + 32])
            if status and status["errors"]:
                raise PrinterError("; ".join(status["errors"]))

        return len(data)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001 — Brother never sends FIN; ignore close races
            pass
