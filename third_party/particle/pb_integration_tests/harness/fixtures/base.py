# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Base fixture protocol for integration tests.

Fixtures are reusable test infrastructure components that can be started
and stopped. They make no assumptions about what they provide - each
fixture type defines its own interface.
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class Fixture(Protocol):
    """Protocol for test fixtures.

    Fixtures provide reusable test infrastructure (devices, mock servers,
    services). They support async context manager protocol for lifecycle
    management.

    Example:
        class MyFixture:
            async def start(self) -> None:
                # Set up resources
                ...

            async def stop(self) -> None:
                # Clean up resources
                ...

        # Usage with context manager
        async with MyFixture() as fixture:
            # Use fixture
            ...

        # Or manual lifecycle
        fixture = MyFixture()
        await fixture.start()
        try:
            # Use fixture
            ...
        finally:
            await fixture.stop()
    """

    async def start(self) -> None:
        """Start the fixture and allocate resources.

        This method should be idempotent - calling it multiple times
        without stop() in between should be safe.

        Raises:
            RuntimeError: If fixture cannot be started.
        """
        ...

    async def stop(self) -> None:
        """Stop the fixture and release resources.

        This method should be idempotent - calling it multiple times
        should be safe.
        """
        ...

    async def __aenter__(self) -> "Fixture":
        """Enter async context manager."""
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit async context manager."""
        await self.stop()
