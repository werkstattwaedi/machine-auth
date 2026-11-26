# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""RPC wiring of sensing + SetPower in main.py (ADR-0035, ADR-0054)."""

import json
import unittest

import httpx
from pw_rpc import packets
from pw_rpc.descriptors import RpcIds

from gateway.gateway_service_pb2 import (
    AcquireSensingLeaseRequest,
    PowerSignalRole,
    SensingLeaseResponse,
    SensingSpec,
    SetPowerRequest,
    SetPowerResponse,
)
from maco_gateway import main
from maco_gateway.sensing.service import SensingService, make_backend_factory
from maco_gateway.sensing.shelly import (
    ShellyDevice,
    ShellyPowerBackend,
    SignalRole,
)
from maco_gateway.sensing.shelly_fake import FakeShelly


class _Writer:
    def get_extra_info(self, _name):
        return ("test", 0)


def _cnc_spec() -> SensingSpec:
    spec = SensingSpec()
    sp = spec.shelly_power
    sp.actuator.host = "localhost:8101"
    sp.actuator.component = "switch:0"
    sig = sp.signals.add()
    sig.source.host = "localhost:8102"
    sig.source.component = "em1:0"
    sig.role = PowerSignalRole.Value("POWER_SIGNAL_ROLE_BILLABLE")
    sig.threshold_w = 40
    sig.rise_sec = 3
    sig.fall_sec = 10
    sp.orphan_off_after_sec = 1800
    return spec


class BackendSpecTest(unittest.TestCase):
    def test_shelly_power(self):
        b = main._backend_spec(_cnc_spec())
        self.assertEqual(b.kind, "shelly_power")
        self.assertEqual(b.shelly.actuator.host, "localhost:8101")
        self.assertEqual(b.shelly.signals[0].role, SignalRole.BILLABLE)
        self.assertEqual(b.shelly.orphan_off_after_sec, 1800)
        self.assertEqual(b.prober_key(), ("shelly_power", "localhost:8101", "switch:0"))

    def test_meter_only_and_unspecified_role(self):
        spec = _cnc_spec()
        spec.shelly_power.ClearField("actuator")
        spec.shelly_power.signals[0].role = 0
        b = main._backend_spec(spec)
        self.assertIsNone(b.shelly.actuator)
        self.assertEqual(b.shelly.signals[0].role, SignalRole.ACTIVITY)

    def test_empty_shelly_spec_is_rejected(self):
        spec = SensingSpec()
        spec.shelly_power.poll_interval_sec = 2
        with self.assertRaises(ValueError):
            main._backend_spec(spec)

    def test_xtool_unchanged(self):
        spec = SensingSpec()
        spec.xtool_laser.host = "laser.internal"
        b = main._backend_spec(spec)
        self.assertEqual((b.kind, b.host), ("xtool_laser", "laser.internal"))


class SetPowerRpcTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.gantry = FakeShelly(["switch:0"])
        self.spindle = FakeShelly(["em1:0"])
        devices = {"localhost:8101": self.gantry, "localhost:8102": self.spindle}

        def handler(request):
            host = f"{request.url.host}:{request.url.port}"
            code, headers, body = devices[host].handle(
                request.method, request.url.raw_path.decode(),
                request.headers.get("authorization"))
            return httpx.Response(code, headers=headers, content=json.dumps(body))

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        def factory(spec):
            if spec.kind == "shelly_power":
                return ShellyPowerBackend(
                    spec.shelly,
                    device_factory=lambda host: ShellyDevice(host, client=client))
            return make_backend_factory()(spec)

        self.sensing = SensingService(factory=factory)
        self.conn = main.ClientConnection(
            None, _Writer(), None, None, None, self.sensing)

    async def asyncTearDown(self):
        await self.sensing.shutdown()

    def _rpc(self, method):
        return RpcIds(main.GATEWAY_CHANNEL_ID, main._SERVICE_ID, method, 1)

    async def test_set_power_then_lease_reports_active(self):
        req = SetPowerRequest(spec=_cnc_spec(), on=True)
        out = await self.conn._handle_set_power(
            self._rpc(main._METHOD_SET_POWER), req.SerializeToString())
        resp = SetPowerResponse.FromString(packets.decode(out).payload)
        self.assertTrue(resp.ok)
        self.assertTrue(resp.reachable)
        self.assertTrue(self.gantry.output["switch:0"])

        acq = AcquireSensingLeaseRequest(spec=_cnc_spec())
        out = await self.conn._handle_acquire_sensing_lease(
            self._rpc(main._METHOD_ACQUIRE_SENSING_LEASE), acq.SerializeToString())
        lease = SensingLeaseResponse.FromString(packets.decode(out).payload)
        self.assertTrue(lease.valid)
        self.assertFalse(lease.active)
        self.assertEqual(len(self.sensing._probers), 1)

    async def test_set_power_on_mock_is_not_ok(self):
        spec = SensingSpec()
        spec.mock.SetInParent()
        out = await self.conn._handle_set_power(
            self._rpc(main._METHOD_SET_POWER),
            SetPowerRequest(spec=spec, on=True).SerializeToString())
        resp = SetPowerResponse.FromString(packets.decode(out).payload)
        self.assertFalse(resp.ok)


if __name__ == "__main__":
    unittest.main()
