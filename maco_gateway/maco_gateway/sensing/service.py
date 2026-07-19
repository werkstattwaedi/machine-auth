# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Lease-managed sensing service (ADR-0035).

A terminal ``AcquireSensingLease`` starts (or reuses) a background prober for a
machine and returns a lease id; ``RenewSensingLease`` is the poll — it extends
the lease and returns the current state. Probers are ref-counted by their live
leases; a reaper sweeps expired leases and stops a prober once its last lease
lapses, so the device connection is held open only while a terminal is actively
sensing.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from dataclasses import dataclass
from typing import Callable, Dict, Optional, Tuple

from .backends import MockBackend, SensingBackend, SensingState, XToolLaserBackend

logger = logging.getLogger(__name__)

DEFAULT_LEASE_TTL_S = 60.0
REAPER_INTERVAL_S = 5.0

# (kind, host) — identifies a prober; multiple leases can share one.
ProberKey = Tuple[str, str]

# kind -> backend factory. Signature: (host, port, poll_interval_sec) -> backend.
BackendFactory = Callable[[str, int, int], SensingBackend]


def default_backend_factory(kind: str, host: str, port: int,
                            poll_interval_sec: int) -> SensingBackend:
    if kind == "xtool_laser":
        return XToolLaserBackend(host, port, poll_interval_sec)
    if kind == "mock":
        return MockBackend()
    raise ValueError(f"unknown sensing backend kind: {kind!r}")


@dataclass
class _ProberEntry:
    backend: SensingBackend
    refcount: int = 0


@dataclass
class _Lease:
    prober_key: ProberKey
    ttl_s: float
    expiry: float  # monotonic loop.time()


class SensingService:
    """Owns the prober + lease registries. Lives on the gateway event loop."""

    def __init__(self, factory: Callable[..., SensingBackend] = None) -> None:
        # factory(kind, host, port, poll_interval_sec) -> SensingBackend.
        self._factory = factory or default_backend_factory
        self._probers: Dict[ProberKey, _ProberEntry] = {}
        self._leases: Dict[str, _Lease] = {}

    @staticmethod
    def _now() -> float:
        return asyncio.get_running_loop().time()

    async def acquire(self, *, kind: str, host: str = "", port: int = 0,
                      poll_interval_sec: int = 0,
                      ttl_sec: float = 0) -> Tuple[str, bool, SensingState]:
        """Start/reuse a prober and mint a lease. Returns (lease_id, valid, state)."""
        key: ProberKey = (kind, host)
        entry = self._probers.get(key)
        if entry is None:
            # Insert the entry before the first await so concurrent acquires for
            # the same key don't double-create the backend (single-threaded loop).
            entry = _ProberEntry(backend=self._factory(kind, host, port, poll_interval_sec))
            self._probers[key] = entry
            await entry.backend.start()
        entry.refcount += 1

        lease_id = secrets.token_hex(16)
        ttl = float(ttl_sec) or DEFAULT_LEASE_TTL_S
        self._leases[lease_id] = _Lease(prober_key=key, ttl_s=ttl,
                                        expiry=self._now() + ttl)
        logger.info("sensing: lease %s acquired for %s (%d leases on prober)",
                    lease_id[:8], key, entry.refcount)
        return lease_id, True, entry.backend.state()

    def renew(self, lease_id: str) -> Tuple[str, bool, SensingState]:
        """Extend a lease and read current state. Returns (lease_id, valid, state)."""
        lease = self._leases.get(lease_id)
        if lease is None or lease.expiry <= self._now():
            return "", False, SensingState.UNSPECIFIED
        lease.expiry = self._now() + lease.ttl_s
        entry = self._probers.get(lease.prober_key)
        state = entry.backend.state() if entry else SensingState.UNREACHABLE
        return lease_id, True, state

    async def run_reaper(self) -> None:
        """Periodically drop expired leases and stop orphaned probers."""
        logger.info("sensing: lease reaper started")
        while True:
            await asyncio.sleep(REAPER_INTERVAL_S)
            # The reaper runs under the top-level asyncio.gather in main.serve();
            # an unhandled error here would tear down the whole gateway. A
            # transient sensing-backend failure must not do that — log and keep
            # sweeping so the next interval retries.
            try:
                await self._sweep()
            except Exception:
                logger.exception("sensing: reaper sweep failed; continuing")

    async def _sweep(self) -> None:
        now = self._now()
        expired = [lid for lid, l in self._leases.items() if l.expiry <= now]
        for lid in expired:
            lease = self._leases.pop(lid)
            entry = self._probers.get(lease.prober_key)
            if entry is None:
                continue
            entry.refcount -= 1
            if entry.refcount <= 0:
                self._probers.pop(lease.prober_key, None)
                # Best-effort stop: one backend failing to stop must not abort
                # the sweep and leak the remaining expired leases/probers.
                try:
                    await entry.backend.stop()
                    logger.info("sensing: prober %s stopped (lease %s lapsed)",
                                lease.prober_key, lid[:8])
                except Exception:
                    logger.exception(
                        "sensing: prober %s stop failed (lease %s lapsed)",
                        lease.prober_key, lid[:8])

    async def shutdown(self) -> None:
        """Stop every prober (gateway shutdown)."""
        for entry in list(self._probers.values()):
            await entry.backend.stop()
        self._probers.clear()
        self._leases.clear()
