# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Gateway heartbeat and terminal status reports (ADR-0045, phase 2c).

Every terminal pings the gateway every 15 s and, since phase 2c, sends its
firmware version, uptime, reset reason and boot count with the ping. The
gateway keeps the latest of each in memory and posts all of it, plus its
own version and uptime, to the `api` function's `/device-status` route:

  - every 5 minutes, around the clock — the heartbeat. A Cloud Monitoring
    alert fires when it stops. It also keeps the `api` function warm, so it
    replaced the opening-hours warm pinger (ADR-0037);
  - at once when a terminal shows up, misses its pings for a minute, comes
    back, reboots (uptime went down) or runs a new version — so an offline
    terminal is alerted within minutes, not at the next heartbeat. At most
    one such extra report per 30 s, so a crash-looping terminal can't flood
    the function.

The cloud side decides what is worth a Firestore write; the gateway just
reports. A failed report is retried at the next tick and never disturbs the
gateway.
"""

import asyncio
import logging
import re
import socket
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Dict, Optional

if TYPE_CHECKING:
    from .firebase_client import FirebaseClient

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_S = 300.0
# Four missed 15 s pings.
OFFLINE_AFTER_S = 60.0
TICK_S = 5.0
MIN_URGENT_GAP_S = 30.0

_GATEWAY_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def read_version(path: Optional[Path] = None) -> str:
    """The release version deploy-gateway.ts wrote next to the package."""
    path = path or Path(__file__).resolve().parent.parent / "VERSION"
    try:
        version = path.read_text().strip()
        return version or "dev"
    except OSError:
        return "dev"


def default_gateway_id() -> str:
    """The host name, shaped into an id the cloud accepts."""
    name = re.sub(r"[^a-z0-9-]", "-", socket.gethostname().split(".")[0].lower())
    name = name.strip("-")[:40]
    return name if _GATEWAY_ID_RE.match(name) else "gateway"


def valid_gateway_id(value: str) -> bool:
    return bool(_GATEWAY_ID_RE.match(value))


@dataclass
class _Terminal:
    version: str
    uptime_ms: int
    reset_reason: int
    boot_count: int
    last_ping: float
    online: bool = True


class DeviceStatusReporter:
    """Collects terminal pings; reports them with the gateway heartbeat."""

    def __init__(
        self,
        client: "FirebaseClient",
        gateway_id: str,
        version: str,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._gateway_id = gateway_id
        self._version = version
        self._clock = clock
        self._started = clock()
        self._terminals: Dict[str, _Terminal] = {}
        self._urgent = False
        self._last_sent: Optional[float] = None
        # Log a failing report once per streak, not every tick.
        self._last_ok: Optional[bool] = None

    def on_ping(
        self,
        device_id: bytes,
        version: str,
        uptime_ms: int,
        reset_reason: int,
        boot_count: int,
    ) -> None:
        """Record a terminal ping (called from the Ping RPC handler)."""
        key = device_id.hex()
        now = self._clock()
        prev = self._terminals.get(key)
        if prev is None:
            logger.info("status: terminal %s seen (version %s)", key, version or "?")
            self._urgent = True
        elif not prev.online:
            logger.info("status: terminal %s back online", key)
            self._urgent = True
        elif version and version != prev.version:
            self._urgent = True
        elif uptime_ms and uptime_ms < prev.uptime_ms:
            logger.info("status: terminal %s rebooted (reset reason %d)", key, reset_reason)
            self._urgent = True
        self._terminals[key] = _Terminal(
            version=version,
            uptime_ms=uptime_ms,
            reset_reason=reset_reason,
            boot_count=boot_count,
            last_ping=now,
        )

    def _mark_offline(self, now: float) -> None:
        for key, t in self._terminals.items():
            if t.online and now - t.last_ping > OFFLINE_AFTER_S:
                logger.warning("status: terminal %s missed its pings — offline", key)
                t.online = False
                self._urgent = True

    def payload(self) -> dict:
        now = self._clock()
        terminals = []
        for key, t in sorted(self._terminals.items()):
            # Firmware before phase 2c sends the fields empty: unknown.
            terminals.append(
                {
                    "deviceId": key,
                    "version": t.version or None,
                    "online": t.online,
                    "uptimeMs": t.uptime_ms or None,
                    "lastPingAgoMs": int((now - t.last_ping) * 1000),
                    "resetReason": t.reset_reason if t.uptime_ms else None,
                    "bootCount": t.boot_count or None,
                }
            )
        return {
            "gateway": {
                "id": self._gateway_id,
                "version": self._version,
                "uptimeMs": int((now - self._started) * 1000),
            },
            "terminals": terminals,
        }

    def _due(self, now: float) -> bool:
        if self._last_sent is None:
            return True
        since = now - self._last_sent
        return since >= HEARTBEAT_INTERVAL_S or (self._urgent and since >= MIN_URGENT_GAP_S)

    async def tick(self) -> None:
        """One step: notice silent terminals, report if due."""
        now = self._clock()
        self._mark_offline(now)
        if not self._due(now):
            return
        self._last_sent = now
        try:
            ok = await self._client.post_device_status(self.payload())
        except Exception:  # never let reporting disturb the gateway
            logger.debug("status report raised", exc_info=True)
            ok = False
        if ok:
            self._urgent = False
        if ok and self._last_ok is not True:
            logger.info("status: reporting to the cloud")
        elif not ok and self._last_ok is not False:
            logger.warning("status: report failed (will keep retrying)")
        self._last_ok = ok

    async def run(self) -> None:
        logger.info(
            "status: reporting as %r (version %s) every %ds",
            self._gateway_id,
            self._version,
            int(HEARTBEAT_INTERVAL_S),
        )
        while True:
            await self.tick()
            await asyncio.sleep(TICK_S)
