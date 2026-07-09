# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Sensing backends: a machine-activity prober per device family.

A backend maintains a live connection to a device on its own asyncio task and
exposes the latest :class:`SensingState`. Backends are proto-agnostic (the RPC
layer maps to/from the wire enum) so they're unit-testable without protobuf.
"""

from __future__ import annotations

import abc
import asyncio
import enum
import logging
import time
from typing import Any, Optional

from .wsv2 import WSV2Connection

logger = logging.getLogger(__name__)


class SensingState(enum.IntEnum):
    """Mirrors the wire ``SensingState`` enum (same int values)."""

    UNSPECIFIED = 0
    UNREACHABLE = 1  # can't reach the device -> terminal treats as idle
    IDLE = 2         # reachable, not working
    RUNNING = 3      # reachable, actively working (e.g. laser cutting)


class SensingBackend(abc.ABC):
    """A background prober for one device. ``start``/``stop`` own its task."""

    @abc.abstractmethod
    async def start(self) -> None: ...

    @abc.abstractmethod
    async def stop(self) -> None: ...

    @abc.abstractmethod
    def state(self) -> SensingState: ...


class MockBackend(SensingBackend):
    """Scriptable backend for the host simulator and tests."""

    def __init__(self, initial: SensingState = SensingState.IDLE) -> None:
        self._state = initial
        self._started = False

    async def start(self) -> None:
        self._started = True

    async def stop(self) -> None:
        self._started = False

    def state(self) -> SensingState:
        return self._state

    def set_state(self, state: SensingState) -> None:
        """Test/sim hook to drive the reported state."""
        self._state = state


class XToolLaserBackend(SensingBackend):
    """Senses whether an xTool laser is cutting, over its WS-V2 protocol.

    Maintains a TLS WebSocket to the laser, does the guest parity handshake,
    heartbeats, and polls ``/v1/device/runningStatus``. ``curMode.subMode ==
    "working"`` means cutting. A dropped/failed connection reports UNREACHABLE
    (which the terminal treats as idle → session auto-ends), and the backend
    reconnects with a fixed backoff.
    """

    DEFAULT_PORT = 28900
    DEFAULT_POLL_S = 3.0
    # Keepalive cadence to the device. Pinned near the ~3s the firmware expects,
    # independent of the (configurable) runningStatus poll interval — raising
    # the poll interval must not stretch the heartbeat and make the laser drop
    # the connection.
    HEARTBEAT_S = 3.0
    CONNECT_TIMEOUT_S = 6.0
    RECONNECT_DELAY_S = 3.0
    PARITY_USER_KEY = "bWFrZWJsb2NrLXh0b29s"  # base64("makeblock-xtool")
    PING_TXN = 65510

    def __init__(self, host: str, port: int = 0, poll_interval_sec: int = 0,
                 *, connector=None) -> None:
        self._host = host
        self._port = port or self.DEFAULT_PORT
        self._poll_s = float(poll_interval_sec) or self.DEFAULT_POLL_S
        self._state = SensingState.UNREACHABLE
        self._task: Optional[asyncio.Task] = None
        self._closing = False
        self._txn = 0
        # Injectable for tests/sim; production connects over TLS.
        self._connector = connector or WSV2Connection.connect

    async def start(self) -> None:
        if self._task is None:
            self._closing = False
            self._task = asyncio.create_task(self._run())
            logger.info("xTool sensing: prober started for %s:%d", self._host, self._port)

    async def stop(self) -> None:
        self._closing = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
            logger.info("xTool sensing: prober stopped for %s", self._host)

    def state(self) -> SensingState:
        return self._state

    def _next_txn(self) -> int:
        self._txn = (self._txn % 65000) + 1
        return self._txn

    def _request(self, url: str, txn: Optional[int] = None,
                 data: Optional[dict] = None) -> dict:
        return {
            "type": "request",
            "method": "GET",
            "url": url,
            "params": {},
            "data": data or {},
            "timestamp": int(time.time() * 1000),
            "transactionId": self._next_txn() if txn is None else txn,
        }

    async def _run(self) -> None:
        while not self._closing:
            try:
                await self._session()
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001 — any failure => unreachable
                logger.debug("xTool sensing: session to %s ended: %s", self._host, err)
            self._state = SensingState.UNREACHABLE
            if self._closing:
                break
            await asyncio.sleep(self.RECONNECT_DELAY_S)

    async def _session(self) -> None:
        conn = await self._connector(
            self._host, self._port,
            connect_id=int(time.time() * 1000),
            timeout=self.CONNECT_TIMEOUT_S,
        )
        try:
            await conn.send_json(self._request(
                "/v1/user/parity",
                data={"userID": "mk-guest", "userKey": self.PARITY_USER_KEY,
                      "timezone": "Europe/Zurich"},
            ))
            # Connected + handshake sent: reachable. Refined by each poll below.
            self._state = SensingState.IDLE
            loop = asyncio.get_running_loop()
            # Heartbeat and runningStatus poll run on independent schedules so a
            # large poll interval can't stretch the keepalive.
            next_ping = loop.time()
            next_poll = loop.time()
            while not self._closing:
                now = loop.time()
                if now >= next_ping:
                    await conn.send_json(
                        self._request("/v1/user/ping", txn=self.PING_TXN))
                    next_ping = now + self.HEARTBEAT_S
                if now >= next_poll:
                    await conn.send_json(
                        self._request("/v1/device/runningStatus"))
                    next_poll = now + self._poll_s
                wake = min(next_ping, next_poll)
                while True:
                    remaining = wake - loop.time()
                    if remaining <= 0:
                        break
                    try:
                        objs = await asyncio.wait_for(
                            conn.recv_json(), timeout=remaining)
                    except asyncio.TimeoutError:
                        break
                    for obj in objs:
                        self._apply(obj)
        finally:
            await conn.close()

    def _apply(self, obj: Any) -> None:
        if not isinstance(obj, dict):
            return
        if obj.get("type") == "response":
            cur = (obj.get("data") or {}).get("curMode")
            if isinstance(cur, dict):
                self._state = self._map_mode(cur)
        elif obj.get("url") == "/work/mode":
            info = (obj.get("data") or {}).get("info")
            if isinstance(info, dict):
                self._state = self._map_mode(info)

    @staticmethod
    def _map_mode(cur: dict) -> SensingState:
        # P2S reports curMode {mode:"Work", subMode:"working"} while cutting;
        # "workReady" = loaded-not-started, "P_IDLE"/other = idle.
        if str(cur.get("subMode", "")).lower() == "working":
            return SensingState.RUNNING
        return SensingState.IDLE
