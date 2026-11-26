# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Shelly Gen2+ power metering and switching (ADR-0054).

``ShellyDevice`` is a thin client for one device's local JSON-RPC over HTTP.
``ShellyPowerBackend`` composes devices into one machine: an optional actuator
(the switch a session turns on/off) and power signals that decide billing
(``BILLABLE``) and activity (``ACTIVITY``).

Specs are plain dataclasses, not protobuf, so the backend stays unit-testable
without the generated code (same as the other backends).
"""

from __future__ import annotations

import asyncio
import enum
import logging
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

import httpx

from .backends import SensingBackend, SensingState

logger = logging.getLogger(__name__)

# Shelly Gen2+ has a single, fixed account name for local auth.
SHELLY_USER = "admin"
# Short so one dead device can't stall a poll round (they run concurrently)
# or hold up a terminal's SetPower RPC for long.
DEFAULT_TIMEOUT_S = 3.0


class ShellyError(Exception):
    """The device answered, but not with something usable (auth, bad JSON…)."""


class ShellyUnreachable(ShellyError):
    """The device did not answer (connect error, timeout)."""


def _split_component(component: str) -> Tuple[str, int]:
    kind, sep, idx = component.partition(":")
    if not sep or not idx.isdigit():
        raise ValueError(f"bad Shelly component {component!r} (want e.g. 'switch:0')")
    return kind, int(idx)


def power_w(status: dict, component: str) -> float:
    """Active power of ``component`` in a ``Shelly.GetStatus`` result.

    switch/pm1 report ``apower``; the em/em1 meters report ``act_power``.
    """
    comp = status.get(component) if isinstance(status, dict) else None
    if not isinstance(comp, dict):
        raise ShellyError(f"component {component!r} missing from status")
    for key in ("apower", "act_power"):
        value = comp.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    raise ShellyError(f"component {component!r} has no power reading")


def switch_output(status: dict, component: str) -> Optional[bool]:
    """The ``output`` of a switch component, or None if it isn't reported."""
    comp = status.get(component) if isinstance(status, dict) else None
    if isinstance(comp, dict) and isinstance(comp.get("output"), bool):
        return comp["output"]
    return None


class ShellyDevice:
    """One Shelly Gen2+ device, addressed as ``host`` or ``host:port``."""

    def __init__(self, host: str, password: str = "", *,
                 client: Optional[httpx.AsyncClient] = None,
                 timeout_s: float = DEFAULT_TIMEOUT_S) -> None:
        self.host = host
        self._base = f"http://{host}"
        # Shelly answers 401 with a SHA-256 digest challenge; httpx's
        # DigestAuth handles algorithm=SHA-256 and caches the nonce per device.
        self._auth = httpx.DigestAuth(SHELLY_USER, password) if password else None
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout_s)
        self._timeout_s = timeout_s

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def rpc(self, method: str, params: Optional[dict] = None) -> dict:
        query = {k: _query_value(v) for k, v in (params or {}).items()}
        try:
            resp = await self._client.get(
                f"{self._base}/rpc/{method}", params=query, auth=self._auth,
                timeout=self._timeout_s)
        except httpx.TransportError as err:  # connect, read, timeout
            raise ShellyUnreachable(f"{self.host}: {err!r}") from err
        if resp.status_code != 200:
            raise ShellyError(f"{self.host}: {method} -> HTTP {resp.status_code}")
        try:
            body = resp.json()
        except ValueError as err:
            raise ShellyError(f"{self.host}: {method} -> invalid JSON") from err
        if not isinstance(body, dict):
            raise ShellyError(f"{self.host}: {method} -> unexpected body")
        return body

    async def get_status(self) -> dict:
        return await self.rpc("Shelly.GetStatus")

    async def set_output(self, component: str, on: bool) -> bool:
        """Switch a ``switch:N`` output and return what the device now reports."""
        kind, idx = _split_component(component)
        if kind != "switch":
            raise ValueError(f"only switch components can be set, not {component!r}")
        await self.rpc("Switch.Set", {"id": idx, "on": on})
        # Switch.Set only returns was_on; read back so the caller learns the
        # state the relay actually ended in (e.g. overpower protection).
        status = await self.rpc("Switch.GetStatus", {"id": idx})
        output = status.get("output")
        if not isinstance(output, bool):
            raise ShellyError(f"{self.host}: Switch.GetStatus without output")
        return output


def _query_value(value) -> str:
    # Shelly parses query params as JSON values: booleans must be lowercase.
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


# --- Spec --------------------------------------------------------------------


class SignalRole(enum.IntEnum):
    """Mirrors the wire ``PowerSignalRole`` enum (same int values)."""

    UNSPECIFIED = 0
    BILLABLE = 1
    ACTIVITY = 2


@dataclass(frozen=True)
class Endpoint:
    host: str
    component: str


@dataclass(frozen=True)
class PowerSignalSpec:
    source: Endpoint
    role: SignalRole
    threshold_w: float
    rise_sec: float = 0
    fall_sec: float = 0


@dataclass(frozen=True)
class ShellyPowerSpec:
    actuator: Optional[Endpoint]
    signals: Tuple[PowerSignalSpec, ...] = ()
    poll_interval_sec: int = 0
    orphan_off_after_sec: int = 0


# --- Backend -----------------------------------------------------------------


@dataclass
class _SignalTracker:
    """Debounces one power reading into on/off."""

    spec: PowerSignalSpec
    on: bool = False
    above_since: Optional[float] = None
    below_since: Optional[float] = None

    def sample(self, watts: float, now: float) -> None:
        if watts > self.spec.threshold_w:
            self.below_since = None
            if self.above_since is None:
                self.above_since = now
            if not self.on and now - self.above_since >= self.spec.rise_sec:
                self.on = True
        else:
            self.above_since = None
            if self.below_since is None:
                self.below_since = now
            if self.on and now - self.below_since >= self.spec.fall_sec:
                self.on = False

    def gap(self) -> None:
        # A missed reading breaks "continuously above/below": restart the
        # pending timer, but keep `on` so a short blip doesn't drop billing
        # for another rise_sec once the device answers again.
        self.above_since = None
        self.below_since = None


DeviceFactory = Callable[[str], ShellyDevice]


class ShellyPowerBackend(SensingBackend):
    """A machine powered and metered through Shelly devices.

    Polls every distinct host once per interval. ``state()`` is RUNNING while
    any billable signal is on, IDLE otherwise, and UNREACHABLE when a device
    that a signal reads from didn't answer the last poll — never a stale
    RUNNING. ``active()`` is any signal on.
    """

    DEFAULT_POLL_S = 2.0

    def __init__(self, spec: ShellyPowerSpec, password: str = "", *,
                 device_factory: Optional[DeviceFactory] = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._client: Optional[httpx.AsyncClient] = None
        if device_factory is None:
            # One connection pool for all of this machine's devices.
            self._client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S)
            client = self._client
            device_factory = lambda host: ShellyDevice(host, password, client=client)  # noqa: E731
        self._device_factory = device_factory
        self._devices: Dict[str, ShellyDevice] = {}
        self._reachable: Dict[str, bool] = {}
        self._actuator_output: Optional[bool] = None
        self._task: Optional[asyncio.Task] = None
        self._polled = False
        self._idle_since: Optional[float] = None
        self._spec: ShellyPowerSpec = spec
        self._trackers: List[_SignalTracker] = []
        self.reconfigure(spec)

    # -- config --

    @property
    def spec(self) -> ShellyPowerSpec:
        return self._spec

    def reconfigure(self, spec: ShellyPowerSpec) -> None:
        """Adopt a new spec for the same actuator (e.g. retuned thresholds).

        Signals whose spec didn't change keep their debounce state, so a
        terminal rebooting onto new config doesn't blip billing on the others.
        """
        old = {t.spec: t for t in self._trackers}
        self._trackers = [old.pop(s, None) or _SignalTracker(s) for s in spec.signals]
        self._spec = spec
        self._poll_s = float(spec.poll_interval_sec) or self.DEFAULT_POLL_S
        for host in self._hosts():
            if host not in self._devices:
                self._devices[host] = self._device_factory(host)

    def _hosts(self) -> List[str]:
        hosts = [s.source.host for s in self._spec.signals]
        if self._spec.actuator is not None:
            hosts.append(self._spec.actuator.host)
        return list(dict.fromkeys(hosts))

    # -- lifecycle --

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())
            logger.info("shelly sensing: prober started for %s", self._hosts())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        for dev in self._devices.values():
            await dev.aclose()
        if self._client is not None:
            await self._client.aclose()
        logger.info("shelly sensing: prober stopped for %s", self._hosts())

    async def _run(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — never let the prober die
                logger.exception("shelly sensing: poll failed")
            await asyncio.sleep(self._poll_s)

    async def poll_once(self) -> None:
        hosts = self._hosts()
        results = await asyncio.gather(
            *(self._devices[h].get_status() for h in hosts), return_exceptions=True)
        now = self._clock()
        statuses: Dict[str, dict] = {}
        for host, result in zip(hosts, results):
            if isinstance(result, BaseException):
                if self._reachable.get(host, True):
                    logger.warning("shelly sensing: %s not answering: %s", host, result)
                self._reachable[host] = False
            else:
                if self._reachable.get(host) is False:
                    logger.info("shelly sensing: %s answering again", host)
                self._reachable[host] = True
                statuses[host] = result

        for tracker in self._trackers:
            status = statuses.get(tracker.spec.source.host)
            if status is None:
                tracker.gap()
                continue
            try:
                tracker.sample(power_w(status, tracker.spec.source.component), now)
            except ShellyError as err:
                # Answers but the configured component isn't there — treat
                # as unreachable so config errors don't read as "idle".
                logger.warning("shelly sensing: %s", err)
                self._reachable[tracker.spec.source.host] = False
                tracker.gap()

        act = self._spec.actuator
        if act is not None and act.host in statuses:
            output = switch_output(statuses[act.host], act.component)
            if output is not None:
                self._actuator_output = output

        self._polled = True
        if self._signals_reachable() and not self.active():
            if self._idle_since is None:
                self._idle_since = now
        else:
            # Unknown counts as not idle: the backstop must not switch off a
            # machine it can't see.
            self._idle_since = None

    # -- readings --

    def _signals_reachable(self) -> bool:
        return self._polled and all(
            self._reachable.get(t.spec.source.host, False) for t in self._trackers)

    def state(self) -> SensingState:
        if not self._signals_reachable():
            return SensingState.UNREACHABLE
        if any(t.on and t.spec.role == SignalRole.BILLABLE for t in self._trackers):
            return SensingState.RUNNING
        return SensingState.IDLE

    def active(self) -> bool:
        return any(t.on and self._reachable.get(t.spec.source.host, False)
                   for t in self._trackers)

    def idle_seconds(self) -> float:
        """How long every signal has been off (0 while unknown or active)."""
        if self._idle_since is None:
            return 0.0
        return self._clock() - self._idle_since

    def power_on(self) -> bool:
        return bool(self._actuator_output)

    def has_actuator(self) -> bool:
        return self._spec.actuator is not None

    async def set_power(self, on: bool) -> Tuple[bool, bool]:
        act = self._spec.actuator
        if act is None:
            return False, False
        try:
            output = await self._devices[act.host].set_output(act.component, on)
        except ShellyUnreachable as err:
            logger.warning("shelly power: %s unreachable for set %s: %s",
                           act.host, "on" if on else "off", err)
            return False, False
        except ShellyError as err:
            logger.warning("shelly power: %s refused set %s: %s",
                           act.host, "on" if on else "off", err)
            return False, True
        self._actuator_output = output
        if output != on:
            logger.warning("shelly power: %s reports output %s after set %s",
                           act.host, output, on)
        return output == on, True
