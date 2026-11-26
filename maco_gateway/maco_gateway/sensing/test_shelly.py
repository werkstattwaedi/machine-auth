# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Tests for the Shelly client, the power backend and its backstop (ADR-0054)."""

import asyncio
import json
import unittest

import httpx

from maco_gateway.sensing.backends import MockBackend, SensingState
from maco_gateway.sensing.service import (
    BackendSpec,
    SensingService,
    make_backend_factory,
)
from maco_gateway.sensing.shelly import (
    Endpoint,
    PowerSignalSpec,
    ShellyDevice,
    ShellyError,
    ShellyPowerBackend,
    ShellyPowerSpec,
    ShellyUnreachable,
    SignalRole,
    power_w,
)
from maco_gateway.sensing.shelly_fake import FakeShelly

GANTRY = "gantry.test"
SPINDLE = "spindle.test:8102"  # host:port must work too


class _Net:
    """Fake Shellies behind one MockTransport; a host can be taken offline."""

    def __init__(self, devices):
        self.devices = devices
        self.offline = set()

    def handler(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host + (f":{request.url.port}" if request.url.port else "")
        if host in self.offline or host not in self.devices:
            raise httpx.ConnectError("unreachable", request=request)
        code, headers, body = self.devices[host].handle(
            request.method, request.url.raw_path.decode(),
            request.headers.get("authorization"))
        return httpx.Response(code, headers=headers, content=json.dumps(body))

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))

    def device_factory(self, password=""):
        client = self.client()
        return lambda host: ShellyDevice(host, password, client=client)


class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _cnc_spec(orphan_off_after_sec=0, **spindle):
    sp = dict(threshold_w=40, rise_sec=3, fall_sec=10)
    sp.update(spindle)
    return ShellyPowerSpec(
        actuator=Endpoint(GANTRY, "switch:0"),
        signals=(
            PowerSignalSpec(Endpoint(SPINDLE, "em1:0"), SignalRole.BILLABLE, **sp),
            PowerSignalSpec(Endpoint(GANTRY, "switch:0"), SignalRole.ACTIVITY,
                            threshold_w=85, rise_sec=2, fall_sec=10),
        ),
        poll_interval_sec=2,
        orphan_off_after_sec=orphan_off_after_sec,
    )


def _cnc_net(password=""):
    return _Net({
        GANTRY: FakeShelly(["switch:0"], password),
        SPINDLE: FakeShelly(["em1:0"], password),
    })


class PowerParsingTest(unittest.TestCase):
    def test_components(self):
        status = {
            "switch:0": {"id": 0, "output": True, "apower": 72.5},
            "pm1:0": {"id": 0, "apower": 12},
            "em1:0": {"id": 0, "act_power": 950.1},
        }
        self.assertEqual(power_w(status, "switch:0"), 72.5)
        self.assertEqual(power_w(status, "pm1:0"), 12.0)
        self.assertEqual(power_w(status, "em1:0"), 950.1)

    def test_missing_component_or_reading(self):
        with self.assertRaises(ShellyError):
            power_w({}, "pm1:0")
        with self.assertRaises(ShellyError):
            power_w({"pm1:0": {"id": 0}}, "pm1:0")


class ShellyDeviceTest(unittest.IsolatedAsyncioTestCase):
    async def test_status_and_set_output_with_digest_auth(self):
        net = _Net({"sw.test:8101": FakeShelly(["switch:0"], password="s3cret")})
        async with net.client() as client:
            dev = ShellyDevice("sw.test:8101", "s3cret", client=client)
            self.assertTrue(await dev.set_output("switch:0", True))
            self.assertTrue(net.devices["sw.test:8101"].output["switch:0"])
            status = await dev.get_status()
            self.assertTrue(status["switch:0"]["output"])
            self.assertFalse(await dev.set_output("switch:0", False))

    async def test_wrong_password_is_an_error_not_unreachable(self):
        net = _Net({"sw.test": FakeShelly(["switch:0"], password="s3cret")})
        async with net.client() as client:
            dev = ShellyDevice("sw.test", "wrong", client=client)
            with self.assertRaises(ShellyError) as ctx:
                await dev.get_status()
            self.assertNotIsInstance(ctx.exception, ShellyUnreachable)

    async def test_unreachable(self):
        net = _Net({})
        async with net.client() as client:
            with self.assertRaises(ShellyUnreachable):
                await ShellyDevice("gone.test", client=client).get_status()

    async def test_only_switches_can_be_set(self):
        dev = ShellyDevice("x.test", client=_Net({}).client())
        with self.assertRaises(ValueError):
            await dev.set_output("em1:0", True)


class ShellyPowerBackendTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.net = _cnc_net(password="pw")
        self.clock = _Clock()
        self.backend = ShellyPowerBackend(
            _cnc_spec(), device_factory=self.net.device_factory("pw"),
            clock=self.clock)

    async def _poll_at(self, t, spindle_w=None, gantry_w=None):
        self.clock.t = 1000.0 + t
        if spindle_w is not None:
            self.net.devices[SPINDLE].watts["em1:0"] = spindle_w
        if gantry_w is not None:
            self.net.devices[GANTRY].watts["switch:0"] = gantry_w
        await self.backend.poll_once()

    async def test_unreachable_before_first_poll(self):
        self.assertEqual(self.backend.state(), SensingState.UNREACHABLE)
        self.assertFalse(self.backend.active())

    async def test_rise_and_fall(self):
        await self._poll_at(0, spindle_w=900)
        self.assertEqual(self.backend.state(), SensingState.IDLE, "not yet rise_sec")
        await self._poll_at(2)
        self.assertEqual(self.backend.state(), SensingState.IDLE)
        await self._poll_at(3)
        self.assertEqual(self.backend.state(), SensingState.RUNNING)
        self.assertTrue(self.backend.active())
        # A short stop between toolpaths doesn't end billing…
        await self._poll_at(4, spindle_w=0)
        await self._poll_at(12)
        self.assertEqual(self.backend.state(), SensingState.RUNNING)
        # …a stop longer than fall_sec does.
        await self._poll_at(14)
        self.assertEqual(self.backend.state(), SensingState.IDLE)
        self.assertFalse(self.backend.active())

    async def test_inrush_spike_is_not_billed(self):
        await self._poll_at(0, spindle_w=1500)
        await self._poll_at(2, spindle_w=5)
        await self._poll_at(4)
        await self._poll_at(6, spindle_w=1500)
        await self._poll_at(8, spindle_w=5)
        self.assertEqual(self.backend.state(), SensingState.IDLE)

    async def test_activity_signal_is_active_but_not_billed(self):
        await self.backend.set_power(True)
        await self._poll_at(0, gantry_w=100)
        await self._poll_at(2)
        self.assertEqual(self.backend.state(), SensingState.IDLE)
        self.assertTrue(self.backend.active())

    async def test_unreachable_signal_device_never_reports_stale_running(self):
        await self._poll_at(0, spindle_w=900)
        await self._poll_at(3)
        self.assertEqual(self.backend.state(), SensingState.RUNNING)
        self.net.offline.add(SPINDLE)
        await self._poll_at(5)
        self.assertEqual(self.backend.state(), SensingState.UNREACHABLE)
        self.assertFalse(self.backend.active())
        self.assertEqual(self.backend.idle_seconds(), 0.0)
        # Back while still running: billing resumes without a new rise.
        self.net.offline.clear()
        await self._poll_at(7)
        self.assertEqual(self.backend.state(), SensingState.RUNNING)

    async def test_unreachable_actuator_only_does_not_affect_state(self):
        spec = ShellyPowerSpec(
            actuator=Endpoint(GANTRY, "switch:0"),
            signals=(PowerSignalSpec(Endpoint(SPINDLE, "em1:0"),
                                     SignalRole.BILLABLE, threshold_w=40),))
        backend = ShellyPowerBackend(
            spec, device_factory=self.net.device_factory("pw"), clock=self.clock)
        self.net.offline.add(GANTRY)
        await backend.poll_once()
        self.assertEqual(backend.state(), SensingState.IDLE)
        self.assertEqual(await backend.set_power(True), (False, False))

    async def test_set_power_reads_back(self):
        self.assertEqual(await self.backend.set_power(True), (True, True))
        self.assertTrue(self.net.devices[GANTRY].output["switch:0"])
        self.assertTrue(self.backend.power_on())
        self.assertEqual(await self.backend.set_power(False), (True, True))
        self.assertFalse(self.backend.power_on())

    async def test_set_power_without_actuator(self):
        spec = ShellyPowerSpec(actuator=None, signals=_cnc_spec().signals)
        backend = ShellyPowerBackend(
            spec, device_factory=self.net.device_factory("pw"), clock=self.clock)
        self.assertEqual(await backend.set_power(True), (False, False))
        self.assertFalse(backend.has_actuator())

    async def test_poll_learns_actuator_output(self):
        self.net.devices[GANTRY].output["switch:0"] = True  # switched by hand
        await self._poll_at(0)
        self.assertTrue(self.backend.power_on())

    async def test_idle_seconds(self):
        await self._poll_at(0)
        await self._poll_at(30)
        self.assertEqual(self.backend.idle_seconds(), 30.0)
        await self._poll_at(31, spindle_w=900)
        await self._poll_at(34)
        self.assertEqual(self.backend.idle_seconds(), 0.0)

    async def test_reconfigure_keeps_unchanged_signal_state(self):
        await self._poll_at(0, spindle_w=900)
        await self._poll_at(3)
        retuned = _cnc_spec()
        retuned = ShellyPowerSpec(
            actuator=retuned.actuator,
            signals=(retuned.signals[0],
                     PowerSignalSpec(Endpoint(GANTRY, "switch:0"),
                                     SignalRole.ACTIVITY, threshold_w=90)),
            poll_interval_sec=2)
        self.backend.reconfigure(retuned)
        self.assertEqual(self.backend.state(), SensingState.RUNNING)


class _Factory:
    """Production factory, but on the fake network and a fake clock."""

    def __init__(self, net, clock):
        self.net, self.clock = net, clock
        self.created = []

    def __call__(self, spec):
        if spec.kind == "shelly_power":
            b = ShellyPowerBackend(spec.shelly, device_factory=self.net.device_factory(),
                                   clock=self.clock)
        else:
            b = make_backend_factory()(spec)
        self.created.append(b)
        return b


class _Stoppable:
    """Counts stops without touching the real backend's task."""

    def __init__(self, backend):
        self.stops = 0
        orig = backend.stop

        async def stop():
            self.stops += 1
            await orig()
        backend.stop = stop


class PowerServiceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.net = _cnc_net()
        self.clock = _Clock()
        self.factory = _Factory(self.net, self.clock)
        self.svc = SensingService(factory=self.factory)

    async def asyncTearDown(self):
        await self.svc.shutdown()

    def _spec(self, orphan=1800):
        return BackendSpec("shelly_power", shelly=_cnc_spec(orphan_off_after_sec=orphan))

    def _lapse_all(self):
        past = asyncio.get_running_loop().time() - 1
        for lease in self.svc._leases.values():
            lease.expiry = past
        for entry in self.svc._probers.values():
            entry.hold_until = 0

    async def test_set_power_then_acquire_share_one_prober(self):
        self.assertEqual(await self.svc.set_power(self._spec(), True), (True, True))
        status = await self.svc.acquire(self._spec())
        self.assertTrue(status.valid)
        self.assertEqual(len(self.factory.created), 1)

    async def test_retuned_spec_reuses_prober_of_same_switch(self):
        await self.svc.acquire(self._spec())
        await self.svc.acquire(BackendSpec(
            "shelly_power", shelly=_cnc_spec(orphan_off_after_sec=1800, threshold_w=60)))
        self.assertEqual(len(self.factory.created), 1)
        self.assertEqual(self.factory.created[0].spec.signals[0].threshold_w, 60)

    async def test_meter_only_specs_are_keyed_by_content(self):
        meter = lambda w: BackendSpec("shelly_power", shelly=ShellyPowerSpec(  # noqa: E731
            actuator=None, signals=(PowerSignalSpec(
                Endpoint(SPINDLE, "em1:0"), SignalRole.BILLABLE, threshold_w=w),)))
        await self.svc.acquire(meter(40))
        await self.svc.acquire(meter(40))
        await self.svc.acquire(meter(50))
        self.assertEqual(len(self.factory.created), 2)

    async def test_set_power_without_actuator_fails(self):
        self.assertEqual(await self.svc.set_power(BackendSpec("mock"), True),
                         (False, False))

    async def test_active_on_lease(self):
        lease, *_ = await self.svc.acquire(self._spec())
        await self.svc.set_power(self._spec(), True)
        backend = self.factory.created[0]
        self.net.devices[GANTRY].watts["switch:0"] = 100
        await backend.poll_once()
        self.clock.t += 2
        await backend.poll_once()
        status = self.svc.renew(lease)
        self.assertEqual(status.state, SensingState.IDLE)
        self.assertTrue(status.active)

    async def test_lapse_without_power_stops_prober(self):
        await self.svc.acquire(self._spec())
        stops = _Stoppable(self.factory.created[0])
        self._lapse_all()
        await self.svc._sweep()
        self.assertEqual(stops.stops, 1)
        self.assertEqual(self.svc._probers, {})

    async def test_backstop_keeps_power_while_active_then_switches_off(self):
        await self.svc.set_power(self._spec(orphan=60), True)
        await self.svc.acquire(self._spec(orphan=60))
        backend = self.factory.created[0]
        stops = _Stoppable(backend)
        gantry = self.net.devices[GANTRY]

        # Spindle running when the terminal disappears.
        self.net.devices[SPINDLE].watts["em1:0"] = 900
        await backend.poll_once()
        self.clock.t += 3
        await backend.poll_once()
        self._lapse_all()
        with self.assertLogs("maco_gateway.sensing.service", "WARNING") as logs:
            await self.svc._sweep()
        self.assertIn("sensing_orphaned_power_on", logs.output[0])
        self.assertTrue(gantry.output["switch:0"], "not switched off at once")
        self.assertEqual(stops.stops, 0)

        # Still running a long time later: stays on.
        self.clock.t += 600
        await backend.poll_once()
        await self.svc._sweep()
        self.assertTrue(gantry.output["switch:0"])

        # Spindle stops; idle less than orphan_off_after_sec: stays on.
        self.net.devices[SPINDLE].watts["em1:0"] = 0
        self.clock.t += 10
        await backend.poll_once()  # falls after fall_sec
        self.clock.t += 30
        await backend.poll_once()
        await self.svc._sweep()
        self.assertTrue(gantry.output["switch:0"])

        # Idle for orphan_off_after_sec: switched off, prober stopped.
        self.clock.t += 60
        await backend.poll_once()
        with self.assertLogs("maco_gateway.sensing.service", "WARNING") as logs:
            await self.svc._sweep()
        self.assertTrue(any("sensing_orphan_power_off" in l for l in logs.output))
        self.assertFalse(gantry.output["switch:0"])
        self.assertEqual(stops.stops, 1)
        self.assertEqual(self.svc._probers, {})

    async def test_orphan_off_after_zero_never_switches_off(self):
        await self.svc.set_power(self._spec(orphan=0), True)
        backend = self.factory.created[0]
        await backend.poll_once()
        self.clock.t += 100000
        await backend.poll_once()
        self._lapse_all()
        with self.assertLogs("maco_gateway.sensing.service", "WARNING"):
            await self.svc._sweep()
        await self.svc._sweep()
        self.assertTrue(self.net.devices[GANTRY].output["switch:0"])
        self.assertEqual(len(self.svc._probers), 1)

    async def test_new_lease_readopts_orphan(self):
        await self.svc.set_power(self._spec(orphan=60), True)
        backend = self.factory.created[0]
        await backend.poll_once()
        self._lapse_all()
        with self.assertLogs("maco_gateway.sensing.service", "WARNING"):
            await self.svc._sweep()
        entry = next(iter(self.svc._probers.values()))
        self.assertTrue(entry.orphaned)

        status = await self.svc.acquire(self._spec(orphan=60))
        self.assertTrue(status.valid)
        self.assertEqual(len(self.factory.created), 1, "same prober")
        self.assertFalse(entry.orphaned)
        # Idle long past the limit, but leased: the terminal decides.
        self.clock.t += 1000
        await backend.poll_once()
        await self.svc._sweep()
        self.assertTrue(self.net.devices[GANTRY].output["switch:0"])

    async def test_set_power_grace_before_first_acquire(self):
        await self.svc.set_power(self._spec(orphan=60), True)
        backend = self.factory.created[0]
        await backend.poll_once()
        self.clock.t += 1000
        await backend.poll_once()
        await self.svc._sweep()  # within the grace: not orphaned, not off
        entry = next(iter(self.svc._probers.values()))
        self.assertFalse(entry.orphaned)
        self.assertTrue(self.net.devices[GANTRY].output["switch:0"])

    async def test_set_power_on_unreachable_then_stops_after_grace(self):
        self.net.offline.add(GANTRY)
        self.assertEqual(await self.svc.set_power(self._spec(), True), (False, False))
        self._lapse_all()
        await self.svc._sweep()
        self.assertEqual(self.svc._probers, {})


class OtherBackendsUnaffectedTest(unittest.IsolatedAsyncioTestCase):
    async def test_mock_active_follows_state_unless_set(self):
        b = MockBackend()
        self.assertFalse(b.active())
        b.set_state(SensingState.RUNNING)
        self.assertTrue(b.active())
        b.set_active(False)
        self.assertFalse(b.active())
        b.set_active(None)
        self.assertTrue(b.active())
        self.assertEqual(await b.set_power(True), (False, False))

    async def test_mock_lease_reports_active(self):
        svc = SensingService()
        status = await svc.acquire(BackendSpec("mock"))
        self.assertFalse(status.active)
        svc._probers[("mock", "")].backend.set_active(True)
        self.assertTrue(svc.renew(status.lease_id).active)

    def test_xtool_key_unchanged(self):
        self.assertEqual(BackendSpec("xtool_laser", "laser.a", 28900).prober_key(),
                         ("xtool_laser", "laser.a"))


if __name__ == "__main__":
    unittest.main()
