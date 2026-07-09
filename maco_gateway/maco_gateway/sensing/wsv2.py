# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""xTool WS-V2 wire layer: CRC-16 envelope + a minimal async WebSocket client.

The xTool V2 firmware exposes its local control/telemetry as a proprietary,
TLS-encrypted WebSocket protocol on port 28900. Every JSON payload is wrapped in
a CRC-16/ARC binary envelope (magic ``0xBABE``); raw TEXT frames are dropped by
the device. This module is ported from the validated PoC.

We speak WebSocket directly on an asyncio TLS stream instead of pulling in a
third-party ``websockets`` dependency — the framing we need is small and this
keeps the gateway's Bazel pip set unchanged.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import ssl
import struct
from typing import Any, List, Tuple

FRAME_MAGIC = b"\xba\xbe"
PROTOCOL_JSON = 4


def crc16(data: bytes) -> int:
    """CRC-16/ARC (poly 0x8005 reflected = 0xA001, init 0), Studio's crc16_default."""
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc & 0xFFFF


def encode_frame(payload: bytes, protocol_type: int = PROTOCOL_JSON) -> bytes:
    """Wrap ``payload`` in the 10-byte ``0xBABE`` CRC envelope."""
    header = bytearray(10)
    header[0:2] = FRAME_MAGIC
    n = len(payload)
    header[2], header[3], header[4] = (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF
    header[5] = protocol_type & 0x7F  # top bit 0 => CRC enabled
    payload_crc = crc16(payload)
    header[6], header[7] = (payload_crc >> 8) & 0xFF, payload_crc & 0xFF
    header_crc = crc16(bytes(header[0:8]))
    header[8], header[9] = (header_crc >> 8) & 0xFF, header_crc & 0xFF
    return bytes(header) + payload


def decode_frames(buffer: bytes) -> Tuple[List[bytes], bytes]:
    """Extract complete envelope payloads; returns ``(payloads, remainder)``.

    A bad header/payload CRC advances one byte and re-syncs on the next magic.
    """
    payloads: List[bytes] = []
    pos, n = 0, len(buffer)
    while pos + 10 <= n:
        if buffer[pos] != 0xBA or buffer[pos + 1] != 0xBE:
            pos += 1
            continue
        length = (buffer[pos + 2] << 16) | (buffer[pos + 3] << 8) | buffer[pos + 4]
        total = 10 + length
        if pos + total > n:
            break
        header_crc = (buffer[pos + 8] << 8) | buffer[pos + 9]
        if crc16(buffer[pos:pos + 8]) != header_crc:
            pos += 1
            continue
        payload = buffer[pos + 10:pos + total]
        crc_disabled = bool(buffer[pos + 5] & 0x80)
        if not crc_disabled:
            payload_crc = (buffer[pos + 6] << 8) | buffer[pos + 7]
            if crc16(payload) != payload_crc:
                pos += 1
                continue
        payloads.append(payload)
        pos += total
    return payloads, buffer[pos:]


def _insecure_tls_context() -> ssl.SSLContext:
    """TLS context that accepts the laser's self-signed device cert."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class WSV2Connection:
    """A minimal WebSocket client over a TLS asyncio stream, framing JSON envelopes."""

    # WebSocket opcodes
    OP_TEXT = 0x1
    OP_BINARY = 0x2
    OP_CLOSE = 0x8
    OP_PING = 0x9
    OP_PONG = 0xA

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._reader = reader
        self._writer = writer
        self._rx = b""  # envelope re-assembly buffer across WS messages

    @classmethod
    async def connect(cls, host: str, port: int, *, connect_id: int,
                      timeout: float = 6.0) -> "WSV2Connection":
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=_insecure_tls_context()),
            timeout,
        )
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET /websocket?id={connect_id}&function=instruction HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        writer.write(req.encode())
        await writer.drain()
        status_line = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout)
        if b" 101 " not in status_line.split(b"\r\n", 1)[0] + b" ":
            writer.close()
            raise ConnectionError(f"WS upgrade failed: {status_line.splitlines()[0]!r}")
        return cls(reader, writer)

    async def send_json(self, obj: Any) -> None:
        payload = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
        await self._send_ws(self.OP_BINARY, encode_frame(payload))

    async def _send_ws(self, opcode: int, data: bytes) -> None:
        # Client frames MUST be masked (RFC 6455).
        n = len(data)
        header = bytearray([0x80 | opcode])
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
        self._writer.write(bytes(header) + masked)
        await self._writer.drain()

    async def _read_ws_frame(self) -> Tuple[int, bytes]:
        b0b1 = await self._reader.readexactly(2)
        opcode = b0b1[0] & 0x0F
        masked = b0b1[1] & 0x80
        ln = b0b1[1] & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", await self._reader.readexactly(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", await self._reader.readexactly(8))[0]
        mask = await self._reader.readexactly(4) if masked else b""
        data = await self._reader.readexactly(ln) if ln else b""
        if masked:
            data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
        return opcode, data

    async def recv_json(self) -> List[Any]:
        """Read the next WS data frame(s) and return any complete JSON payloads.

        Handles control frames transparently (pong on ping, raise on close).
        Returns a possibly-empty list — a data frame may hold a partial envelope.
        """
        opcode, data = await self._read_ws_frame()
        if opcode == self.OP_CLOSE:
            raise ConnectionError("WS closed by peer")
        if opcode == self.OP_PING:
            await self._send_ws(self.OP_PONG, data)
            return []
        if opcode == self.OP_PONG:
            return []
        # data frame (binary/text/continuation)
        self._rx += data
        payloads, self._rx = decode_frames(self._rx)
        objs: List[Any] = []
        for p in payloads:
            try:
                objs.append(json.loads(p.decode("utf-8", "replace")))
            except json.JSONDecodeError:
                pass
        return objs

    async def close(self) -> None:
        try:
            self._writer.close()
            await self._writer.wait_closed()
        except Exception:  # noqa: BLE001 — closing is best-effort
            pass
