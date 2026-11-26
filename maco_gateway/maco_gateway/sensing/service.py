# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Lease-managed sensing service (ADR-0035, ADR-0054).

A terminal ``AcquireSensingLease`` starts (or reuses) a background prober for a
machine and returns a lease id; ``RenewSensingLease`` is the poll — it extends
the lease and returns the current state. Probers are ref-counted by their live
leases; a reaper sweeps expired leases and stops a prober once its last lease
lapses, so the device connection is held open only while a terminal is actively
sensing.

A prober that switches its machine (``SetPower``, ADR-0054) is the exception:
when nobody holds a lease while its actuator is on, it stays up as the
backstop and switches the machine off once it has been idle for the spec's
``orphan_off_after_sec``.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from dataclasses import dataclass
from typing import Callable, Dict, NamedTuple, Optional, Tuple

from .backends import MockBackend, SensingBackend, SensingState, XToolLaserBackend
from .shelly import ShellyPowerBackend, ShellyPowerSpec

logger = logging.getLogger(__name__)

DEFAULT_LEASE_TTL_S = 60.0
REAPER_INTERVAL_S = 5.0
# A SetPower usually precedes the lease's first acquire; don't call the
# prober orphaned in between.
SET_POWER_GRACE_S = DEFAULT_LEASE_TTL_S


@dataclass(frozen=True)
class BackendSpec:
    """Proto-agnostic SensingSpec: which backend, configured how."""

    kind: str
    host: str = ""
    port: int = 0
    poll_interval_sec: int = 0
    shelly: Optional[ShellyPowerSpec] = None

    def prober_key(self) -> Tuple:
        if self.kind == "shelly_power" and self.shelly is not None:
            act = self.shelly.actuator
            if act is not None:
                # One prober per physical switch, whatever the rest of the
                # spec says: two probers on one relay would fight over it
                # (an orphaned one could switch off a live session).
                return ("shelly_power", act.host.lower(), act.component)
            return ("shelly_power", self.shelly)
        return (self.kind, self.host)


# Identifies a prober; multiple leases (and SetPower calls) share one.
ProberKey = Tuple

BackendFactory = Callable[[BackendSpec], SensingBackend]


class LeaseStatus(NamedTuple):
    lease_id: str
    valid: bool
    state: SensingState
    active: bool


def make_backend_factory(shelly_password: str = "") -> BackendFactory:
    def factory(spec: BackendSpec) -> SensingBackend:
        if spec.kind == "xtool_laser":
            return XToolLaserBackend(spec.host, spec.port, spec.poll_interval_sec)
        if spec.kind == "mock":
            return MockBackend()
        if spec.kind == "shelly_power" and spec.shelly is not None:
            return ShellyPowerBackend(spec.shelly, shelly_password)
        raise ValueError(f"unknown sensing backend kind: {spec.kind!r}")
    return factory


default_backend_factory = make_backend_factory()


@dataclass
class _ProberEntry:
    backend: SensingBackend
    spec: BackendSpec
    refcount: int = 0
    # While unleased, don't evaluate before this (SetPower grace).
    hold_until: float = 0.0
    orphaned: bool = False


@dataclass
class _Lease:
    prober_key: ProberKey
    ttl_s: float
    expiry: float  # monotonic loop.time()


class SensingService:
    """Owns the prober + lease registries. Lives on the gateway event loop."""

    def __init__(self, factory: Optional[BackendFactory] = None) -> None:
        self._factory = factory or default_backend_factory
        self._probers: Dict[ProberKey, _ProberEntry] = {}
        self._leases: Dict[str, _Lease] = {}

    @staticmethod
    def _now() -> float:
        return asyncio.get_running_loop().time()

    async def _entry_for(self, spec: BackendSpec) -> Tuple[ProberKey, _ProberEntry]:
        key = spec.prober_key()
        entry = self._probers.get(key)
        if entry is None:
            # Insert the entry before the first await so concurrent requests for
            # the same key don't double-create the backend (single-threaded loop).
            entry = _ProberEntry(backend=self._factory(spec), spec=spec)
            self._probers[key] = entry
            await entry.backend.start()
        elif spec != entry.spec and isinstance(entry.backend, ShellyPowerBackend):
            # Same switch, new config (e.g. thresholds retuned): the latest
            # terminal's view wins.
            entry.backend.reconfigure(spec.shelly)
            entry.spec = spec
            logger.info("sensing: prober %s reconfigured", key)
        return key, entry

    async def acquire(self, spec: BackendSpec, ttl_sec: float = 0) -> LeaseStatus:
        """Start/reuse a prober and mint a lease."""
        key, entry = await self._entry_for(spec)
        entry.refcount += 1
        if entry.orphaned:
            entry.orphaned = False
            logger.info("sensing_orphan_adopted prober=%s", key)

        lease_id = secrets.token_hex(16)
        ttl = float(ttl_sec) or DEFAULT_LEASE_TTL_S
        self._leases[lease_id] = _Lease(prober_key=key, ttl_s=ttl,
                                        expiry=self._now() + ttl)
        logger.info("sensing: lease %s acquired for %s (%d leases on prober)",
                    lease_id[:8], key, entry.refcount)
        return LeaseStatus(lease_id, True, entry.backend.state(),
                           entry.backend.active())

    def renew(self, lease_id: str) -> LeaseStatus:
        """Extend a lease and read current state."""
        lease = self._leases.get(lease_id)
        if lease is None or lease.expiry <= self._now():
            return LeaseStatus("", False, SensingState.UNSPECIFIED, False)
        lease.expiry = self._now() + lease.ttl_s
        entry = self._probers.get(lease.prober_key)
        if entry is None:
            return LeaseStatus(lease_id, True, SensingState.UNREACHABLE, False)
        return LeaseStatus(lease_id, True, entry.backend.state(),
                           entry.backend.active())

    async def set_power(self, spec: BackendSpec, on: bool) -> Tuple[bool, bool]:
        """Switch the machine of ``spec``. Returns (ok, reachable).

        Goes through the same prober as the lease, so the backstop sees the
        actuator state no matter which call came first.
        """
        key, entry = await self._entry_for(spec)
        if not entry.backend.has_actuator():
            logger.warning("sensing: SetPower for %s, which has no actuator", key)
            ok, reachable = False, False
        else:
            ok, reachable = await entry.backend.set_power(on)
        entry.hold_until = self._now() + SET_POWER_GRACE_S
        logger.info("sensing: SetPower %s for %s -> ok=%s reachable=%s",
                    "on" if on else "off", key, ok, reachable)
        return ok, reachable

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
            if entry is not None:
                entry.refcount -= 1
                logger.info("sensing: lease %s on %s lapsed", lid[:8], lease.prober_key)

        for key, entry in list(self._probers.items()):
            if entry.refcount > 0 or now < entry.hold_until:
                continue
            # Each prober on its own: one failing must not abort the sweep and
            # leak the remaining ones.
            try:
                await self._sweep_unleased(key, entry)
            except Exception:
                logger.exception("sensing: prober %s sweep failed", key)

    async def _sweep_unleased(self, key: ProberKey, entry: _ProberEntry) -> None:
        backend = entry.backend
        if backend.has_actuator() and backend.power_on():
            # Not switched off at once: a gateway or terminal restart would
            # otherwise cost the machine's state (e.g. the mill's homing).
            if not entry.orphaned:
                entry.orphaned = True
                logger.warning(
                    "sensing_orphaned_power_on prober=%s: no lease, machine on; "
                    "switching off after %ss idle", key, self._orphan_off_after(entry))
            limit = self._orphan_off_after(entry)
            if limit <= 0 or backend.idle_seconds() < limit:
                return
            ok, reachable = await backend.set_power(False)
            if entry.refcount > 0:
                # A terminal leased it while the request was in flight; it
                # owns the machine now and sees the state on its next renew.
                return
            if not ok:
                logger.warning("sensing: orphan power-off of %s failed (reachable=%s); "
                               "retrying", key, reachable)
                return
            logger.warning("sensing_orphan_power_off prober=%s idle=%.0fs",
                           key, backend.idle_seconds())
        await self._stop(key, entry)

    @staticmethod
    def _orphan_off_after(entry: _ProberEntry) -> int:
        shelly = entry.spec.shelly
        return shelly.orphan_off_after_sec if shelly is not None else 0

    async def _stop(self, key: ProberKey, entry: _ProberEntry) -> None:
        self._probers.pop(key, None)
        try:
            await entry.backend.stop()
            logger.info("sensing: prober %s stopped", key)
        except Exception:
            logger.exception("sensing: prober %s stop failed", key)

    async def shutdown(self) -> None:
        """Stop every prober (gateway shutdown)."""
        for entry in list(self._probers.values()):
            await entry.backend.stop()
        self._probers.clear()
        self._leases.clear()
