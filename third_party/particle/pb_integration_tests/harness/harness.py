# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Integration test harness for orchestrating fixtures.

The harness manages multiple fixtures and provides a unified interface
for integration tests.
"""

import asyncio
import logging
from typing import TypeVar

from .fixtures.base import Fixture

_LOG = logging.getLogger(__name__)

F = TypeVar("F", bound=Fixture)


class IntegrationTestHarness:
    """Orchestrates fixtures for integration tests.

    The harness manages the lifecycle of multiple fixtures, ensuring
    proper startup order and cleanup on failure.

    Example:
        harness = IntegrationTestHarness()

        gateway = MockGatewayFixture()
        device = P2DeviceFixture(firmware_bin=Path("test.bin"), ...)

        harness.add_fixture("gateway", gateway)
        harness.add_fixture("device", device)

        async with harness:
            # All fixtures are started
            await device.rpc.rpcs.test.TestControl.Configure(
                gateway_host=gateway.host,
                gateway_port=gateway.port,
            )
            # Run test...
    """

    def __init__(self) -> None:
        """Initialize the harness."""
        self._fixtures: dict[str, Fixture] = {}
        self._started: list[str] = []

    def add_fixture(self, name: str, fixture: Fixture) -> None:
        """Add a fixture to the harness.

        Args:
            name: Unique name for the fixture.
            fixture: Fixture instance to add.

        Raises:
            ValueError: If a fixture with the same name already exists.
        """
        if name in self._fixtures:
            raise ValueError(f"Fixture '{name}' already exists")
        self._fixtures[name] = fixture

    def get_fixture(self, name: str) -> Fixture:
        """Get a fixture by name.

        Args:
            name: Name of the fixture.

        Returns:
            The fixture instance.

        Raises:
            KeyError: If fixture does not exist.
        """
        return self._fixtures[name]

    async def start(self) -> None:
        """Start all fixtures in order of addition.

        If a fixture fails to start, all previously started fixtures
        are stopped.

        Raises:
            RuntimeError: If any fixture fails to start.
        """
        for name, fixture in self._fixtures.items():
            _LOG.info("Starting fixture: %s", name)
            try:
                await fixture.start()
                self._started.append(name)
            except Exception as e:
                _LOG.error("Failed to start fixture '%s': %s", name, e)
                # Stop already-started fixtures in reverse order
                await self._stop_started()
                raise RuntimeError(f"Failed to start fixture '{name}'") from e

        _LOG.info("All fixtures started")

    async def stop(self) -> None:
        """Stop all started fixtures in reverse order."""
        await self._stop_started()
        _LOG.info("All fixtures stopped")

    async def _stop_started(self) -> None:
        """Stop fixtures that were successfully started, in reverse order."""
        for name in reversed(self._started):
            fixture = self._fixtures[name]
            _LOG.info("Stopping fixture: %s", name)
            try:
                await fixture.stop()
            except Exception as e:
                _LOG.warning("Error stopping fixture '%s': %s", name, e)
        self._started.clear()

    async def __aenter__(self) -> "IntegrationTestHarness":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()
