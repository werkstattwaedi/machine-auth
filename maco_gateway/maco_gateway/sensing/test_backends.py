# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Tests for sensing backends (state mapping + full xTool session)."""

import asyncio
import base64
import json
import os
import struct
import unittest

from maco_gateway.sensing.backends import (
    MockBackend,
    SensingState,
    XToolLaserBackend,
)
from maco_gateway.sensing.wsv2 import WSV2Connection, encode_frame


class MockBackendTest(unittest.IsolatedAsyncioTestCase):
    async def test_lifecycle_and_state(self):
        b = MockBackend()
        self.assertEqual(b.state(), SensingState.IDLE)
        await b.start()
        b.set_state(SensingState.RUNNING)
        self.assertEqual(b.state(), SensingState.RUNNING)
        await b.stop()


class MapModeTest(unittest.TestCase):
    def test_working_is_running(self):
        self.assertEqual(
            XToolLaserBackend._map_mode({"mode": "Work", "subMode": "working"}),
            SensingState.RUNNING,
        )

    def test_workready_and_unknown_are_idle(self):
        self.assertEqual(
            XToolLaserBackend._map_mode({"mode": "Work", "subMode": "workReady"}),
            SensingState.IDLE,
        )
        self.assertEqual(XToolLaserBackend._map_mode({}), SensingState.IDLE)

    def test_apply_response_and_push(self):
        b = XToolLaserBackend("laser.test")
        b._apply({"type": "response",
                  "data": {"curMode": {"subMode": "working"}}})
        self.assertEqual(b.state(), SensingState.RUNNING)
        b._apply({"url": "/work/mode",
                  "data": {"info": {"subMode": "workReady"}}})
        self.assertEqual(b.state(), SensingState.IDLE)


def _send_unmasked(writer, obj):
    frame = encode_frame(json.dumps(obj, separators=(",", ":")).encode())
    n = len(frame)
    header = bytearray([0x82])  # FIN + binary, server frames unmasked
    if n < 126:
        header.append(n)
    else:
        header.append(126)
        header += struct.pack(">H", n)
    writer.write(bytes(header) + frame)


class _FakeLaserServer:
    """Speaks the WS upgrade + parity/ping/runningStatus, with a mutable subMode."""

    def __init__(self):
        self.sub_mode = "working"
        self._server = None
        self._writers = []

    async def start(self):
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        return self._server.sockets[0].getsockname()[:2]

    async def stop(self):
        for w in self._writers:
            w.close()
        self._server.close()
        await self._server.wait_closed()

    async def _handle(self, reader, writer):
        self._writers.append(writer)
        try:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 101 Switching Protocols\r\n"
                         b"Upgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
            await writer.drain()
            conn = WSV2Connection(reader, writer)
            while True:
                for obj in await conn.recv_json():
                    url = obj.get("url")
                    if url == "/v1/device/runningStatus":
                        _send_unmasked(writer, {
                            "type": "response", "code": 0,
                            "data": {"curMode": {"mode": "Work",
                                                 "subMode": self.sub_mode}}})
                    elif url in ("/v1/user/parity", "/v1/user/ping"):
                        _send_unmasked(writer, {"type": "response", "code": 0,
                                                "data": {}})
                    await writer.drain()
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()


async def _plain_connector(host, port, *, connect_id, timeout):
    reader, writer = await asyncio.open_connection(host, port)
    key = base64.b64encode(os.urandom(16)).decode()
    writer.write(
        f"GET /websocket?id={connect_id}&function=instruction HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode()
    )
    await writer.drain()
    await reader.readuntil(b"\r\n\r\n")
    return WSV2Connection(reader, writer)


async def _wait_for_state(backend, target, timeout=3.0):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if backend.state() == target:
            return True
        await asyncio.sleep(0.02)
    return False


class XToolSessionTest(unittest.IsolatedAsyncioTestCase):
    async def test_reports_running_then_idle_then_unreachable(self):
        laser = _FakeLaserServer()
        host, port = await laser.start()
        backend = XToolLaserBackend(host, port, connector=_plain_connector)
        backend._poll_s = 0.05  # fast poll for the test
        await backend.start()
        try:
            self.assertTrue(await _wait_for_state(backend, SensingState.RUNNING),
                            "should observe RUNNING while cutting")
            laser.sub_mode = "workReady"
            self.assertTrue(await _wait_for_state(backend, SensingState.IDLE),
                            "should observe IDLE when not cutting")
            await laser.stop()
            self.assertTrue(await _wait_for_state(backend, SensingState.UNREACHABLE),
                            "should observe UNREACHABLE after the laser drops")
        finally:
            await backend.stop()


if __name__ == "__main__":
    unittest.main()
