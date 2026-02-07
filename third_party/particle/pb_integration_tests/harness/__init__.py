# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Integration test harness for P2 firmware tests.

This package provides infrastructure for testing firmware-gateway-Firebase
interactions on real P2 hardware.

Example usage:
    from pb_integration_tests.harness import P2DeviceFixture, IntegrationTestHarness
    from pb_integration_tests.harness.fixtures import Fixture

    @pytest.fixture
    async def device():
        fixture = P2DeviceFixture(firmware_bin=Path("test_firmware.bin"))
        await fixture.start()
        yield fixture
        await fixture.stop()

    # Or with harness:
    @pytest.fixture
    async def test_env():
        harness = IntegrationTestHarness()
        harness.add_fixture("device", P2DeviceFixture(...))
        async with harness:
            yield harness
"""

from .fixtures.base import Fixture
from .fixtures.p2_device import P2DeviceFixture
from .harness import IntegrationTestHarness
from .rpc_client import RpcClient

__all__ = ["Fixture", "IntegrationTestHarness", "P2DeviceFixture", "RpcClient"]
