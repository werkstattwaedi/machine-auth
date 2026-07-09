# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Tests for the WS-V2 wire layer (envelope framing + minimal WebSocket)."""

import asyncio
import base64
import os
import struct
import unittest

from maco_gateway.sensing.wsv2 import (
    WSV2Connection,
    crc16,
    decode_frames,
    encode_frame,
)


class EnvelopeTest(unittest.TestCase):
    def test_crc16_known_vector(self):
        # CRC-16/ARC of "123456789" is 0xBB3D.
        self.assertEqual(crc16(b"123456789"), 0xBB3D)

    def test_encode_decode_roundtrip(self):
        payload = b'{"hello":"world"}'
        frame = encode_frame(payload)
        self.assertEqual(frame[0:2], b"\xba\xbe")
        payloads, remainder = decode_frames(frame)
        self.assertEqual(payloads, [payload])
        self.assertEqual(remainder, b"")

    def test_decode_two_frames_and_partial_tail(self):
        a, b = encode_frame(b"AAAA"), encode_frame(b"BBBBBB")
        buf = a + b
        payloads, remainder = decode_frames(buf + b"\xba\xbe\x00")  # partial 3rd
        self.assertEqual(payloads, [b"AAAA", b"BBBBBB"])
        self.assertEqual(remainder, b"\xba\xbe\x00")  # kept for next read

    def test_decode_resyncs_past_garbage(self):
        good = encode_frame(b"payload")
        payloads, _ = decode_frames(b"\x00\x01garbage" + good)
        self.assertEqual(payloads, [b"payload"])

    def test_decode_skips_bad_payload_crc(self):
        frame = bytearray(encode_frame(b"payload"))
        frame[-1] ^= 0xFF  # corrupt payload -> CRC mismatch
        payloads, _ = decode_frames(bytes(frame))
        self.assertEqual(payloads, [])


class _FakeLaser:
    """Minimal plain-TCP server that does the WS upgrade and answers one poll."""

    def __init__(self, response_obj):
        self._response = response_obj
        self.server = None
        self.received = []
        self._writers = []

    async def start(self):
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        return self.server.sockets[0].getsockname()[:2]  # (host, port)

    async def stop(self):
        for w in self._writers:
            w.close()
        self.server.close()
        await self.server.wait_closed()

    async def _handle(self, reader, writer):
        import json

        self._writers.append(writer)
        try:
            # Consume the HTTP upgrade request, reply 101.
            await reader.readuntil(b"\r\n\r\n")
            writer.write(
                b"HTTP/1.1 101 Switching Protocols\r\n"
                b"Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
            )
            await writer.drain()
            # Read one client (masked) WS frame, record the JSON, answer with an
            # envelope-wrapped response frame (server->client frames unmasked).
            server_conn = WSV2Connection(reader, writer)
            objs = []
            while not objs:
                objs = await server_conn.recv_json()
            self.received.extend(objs)
            payload = json.dumps(self._response, separators=(",", ":")).encode()
            frame = encode_frame(payload)
            writer.write(bytes([0x82, len(frame)]) + frame)  # small payload
            await writer.drain()
            await reader.read()  # wait for the client to close before we FIN
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()


async def _connect_plain(host, port):
    """WSV2Connection over plain TCP (test-only; production uses TLS)."""
    reader, writer = await asyncio.open_connection(host, port)
    key = base64.b64encode(os.urandom(16)).decode()
    writer.write(
        f"GET /websocket?id=1&function=instruction HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode()
    )
    await writer.drain()
    status = await reader.readuntil(b"\r\n\r\n")
    assert b"101" in status, status
    return WSV2Connection(reader, writer)


class WebSocketRoundtripTest(unittest.IsolatedAsyncioTestCase):
    async def test_send_and_receive_json_over_socket(self):
        response = {"type": "response", "code": 0,
                    "data": {"curMode": {"mode": "Work", "subMode": "working"}}}
        laser = _FakeLaser(response)
        host, port = await laser.start()
        try:
            conn = await _connect_plain(host, port)
            await conn.send_json({"type": "request", "url": "/v1/device/runningStatus"})
            objs = []
            while not objs:
                objs = await asyncio.wait_for(conn.recv_json(), timeout=2.0)
            self.assertEqual(objs[0]["data"]["curMode"]["subMode"], "working")
            # server decoded our masked client frame correctly
            self.assertEqual(laser.received[0]["url"], "/v1/device/runningStatus")
            await conn.close()
        finally:
            await laser.stop()


if __name__ == "__main__":
    unittest.main()
