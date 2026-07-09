# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Tests for the lease-managed SensingService (ADR-0035)."""

import asyncio
import unittest

from maco_gateway.sensing.backends import MockBackend, SensingState
from maco_gateway.sensing.service import SensingService


class _RecordingBackend(MockBackend):
    def __init__(self):
        super().__init__()
        self.starts = 0
        self.stops = 0

    async def start(self):
        self.starts += 1
        await super().start()

    async def stop(self):
        self.stops += 1
        await super().stop()


class _Factory:
    def __init__(self):
        self.created = []

    def __call__(self, kind, host, port, poll_interval_sec):
        b = _RecordingBackend()
        self.created.append(b)
        return b


class SensingServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_acquire_starts_prober_and_returns_state(self):
        factory = _Factory()
        svc = SensingService(factory=factory)
        lease_id, valid, state = await svc.acquire(kind="mock")
        self.assertTrue(valid)
        self.assertNotEqual(lease_id, "")
        self.assertEqual(len(factory.created), 1)
        self.assertEqual(factory.created[0].starts, 1)
        self.assertEqual(state, SensingState.IDLE)

    async def test_renew_reflects_state_change(self):
        factory = _Factory()
        svc = SensingService(factory=factory)
        lease_id, _, _ = await svc.acquire(kind="mock")
        factory.created[0].set_state(SensingState.RUNNING)
        rid, valid, state = svc.renew(lease_id)
        self.assertTrue(valid)
        self.assertEqual(rid, lease_id)
        self.assertEqual(state, SensingState.RUNNING)

    async def test_unknown_lease_is_invalid(self):
        svc = SensingService(factory=_Factory())
        rid, valid, state = svc.renew("does-not-exist")
        self.assertFalse(valid)
        self.assertEqual(rid, "")
        self.assertEqual(state, SensingState.UNSPECIFIED)

    async def test_two_leases_share_one_prober(self):
        factory = _Factory()
        svc = SensingService(factory=factory)
        await svc.acquire(kind="xtool_laser", host="laser.a")
        await svc.acquire(kind="xtool_laser", host="laser.a")
        self.assertEqual(len(factory.created), 1, "same (kind,host) reuses the prober")

    async def test_expired_lease_reaps_and_stops_prober(self):
        factory = _Factory()
        svc = SensingService(factory=factory)
        l1, _, _ = await svc.acquire(kind="xtool_laser", host="laser.a")
        l2, _, _ = await svc.acquire(kind="xtool_laser", host="laser.a")
        backend = factory.created[0]

        # Expire only the first lease; prober stays up (still one live lease).
        svc._leases[l1].expiry = asyncio.get_running_loop().time() - 1
        await svc._sweep()
        self.assertEqual(backend.stops, 0)
        self.assertFalse(svc.renew(l1)[1])   # l1 gone
        self.assertTrue(svc.renew(l2)[1])    # l2 alive

        # Expire the last lease -> prober stops.
        svc._leases[l2].expiry = asyncio.get_running_loop().time() - 1
        await svc._sweep()
        self.assertEqual(backend.stops, 1)
        self.assertFalse(svc.renew(l2)[1])

    async def test_shutdown_stops_all(self):
        factory = _Factory()
        svc = SensingService(factory=factory)
        await svc.acquire(kind="xtool_laser", host="laser.a")
        await svc.acquire(kind="xtool_laser", host="laser.b")
        await svc.shutdown()
        self.assertTrue(all(b.stops == 1 for b in factory.created))


if __name__ == "__main__":
    unittest.main()
