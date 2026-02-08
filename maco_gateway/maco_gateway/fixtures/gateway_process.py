# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Gateway process fixture for integration tests.

Starts the real maco_gateway as a subprocess, configured to forward
requests to a MockHttpServer instead of real Firebase.
"""

import asyncio
import logging
import os
import signal
import sys
from pathlib import Path
from typing import Optional

_LOG = logging.getLogger(__name__)

# Default master key for testing (must match device configuration)
DEFAULT_TEST_MASTER_KEY = "000102030405060708090A0B0C0D0E0F"

# Path to gateway binary (relative to runfiles root)
DEFAULT_GATEWAY_BINARY = "maco_gateway/gateway"


class GatewayProcess:
    """Runs the real maco_gateway as a subprocess.

    Example:
        mock_server = MockHttpServer()
        await mock_server.start()

        gateway = GatewayProcess(firebase_url=mock_server.url)
        await gateway.start()
        try:
            # Device connects to gateway.host:gateway.port
            # Gateway forwards to mock_server
            pass
        finally:
            await gateway.stop()
            await mock_server.stop()
    """

    def __init__(
        self,
        firebase_url: str,
        host: str = "127.0.0.1",
        port: int = 0,
        master_key: str = DEFAULT_TEST_MASTER_KEY,
        gateway_binary: Optional[str] = None,
    ) -> None:
        """Initialize the gateway process fixture.

        Args:
            firebase_url: URL to forward requests to (e.g., MockHttpServer.url)
            host: Host for gateway to listen on.
            port: Port for gateway to listen on (0 for auto-assign).
            master_key: ASCON master key (hex string).
            gateway_binary: Path to gateway binary (relative to runfiles).
        """
        self._firebase_url = firebase_url
        self._host = host
        self._port = port
        self._master_key = master_key
        self._gateway_binary = gateway_binary or DEFAULT_GATEWAY_BINARY

        self._process: Optional[asyncio.subprocess.Process] = None
        self._actual_port: Optional[int] = None
        self._drain_task: Optional[asyncio.Task] = None

    @property
    def host(self) -> str:
        """Get the gateway host."""
        return self._host

    @property
    def port(self) -> int:
        """Get the actual gateway port."""
        if self._actual_port is None:
            raise RuntimeError("Gateway not started")
        return self._actual_port

    async def start(self) -> None:
        """Start the gateway subprocess."""
        if self._process is not None:
            raise RuntimeError("Gateway already started")

        # Find gateway binary in runfiles
        gateway_path = Path(self._gateway_binary)
        if not gateway_path.is_absolute():
            # Look in runfiles
            runfiles_dir = os.environ.get("RUNFILES_DIR")
            if runfiles_dir:
                gateway_path = Path(runfiles_dir) / "_main" / self._gateway_binary
            else:
                # Try relative to current working directory
                gateway_path = Path(self._gateway_binary)

        if not gateway_path.exists():
            raise RuntimeError(f"Gateway binary not found: {gateway_path}")

        # Build command
        cmd = [
            str(gateway_path),
            "--host",
            self._host,
            "--port",
            str(self._port),
            "--master-key",
            self._master_key,
            "--firebase-url",
            self._firebase_url,
            "--verbose",
        ]

        _LOG.info("Starting gateway: %s", " ".join(cmd))

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        # Wait for gateway to start and parse the listening port from output
        await self._wait_for_ready()

    async def _wait_for_ready(self, timeout: float = 10.0) -> None:
        """Wait for gateway to be ready and parse the port."""
        deadline = asyncio.get_event_loop().time() + timeout
        output_lines = []

        while asyncio.get_event_loop().time() < deadline:
            if self._process.stdout is None:
                raise RuntimeError("No stdout from gateway process")

            try:
                line = await asyncio.wait_for(
                    self._process.stdout.readline(), timeout=1.0
                )
            except asyncio.TimeoutError:
                # Check if process died
                if self._process.returncode is not None:
                    output = "\n".join(output_lines)
                    raise RuntimeError(
                        f"Gateway process exited with code {self._process.returncode}\n"
                        f"Output:\n{output}"
                    )
                continue

            if not line:
                if self._process.returncode is not None:
                    output = "\n".join(output_lines)
                    raise RuntimeError(
                        f"Gateway process exited with code {self._process.returncode}\n"
                        f"Output:\n{output}"
                    )
                continue

            line_str = line.decode("utf-8", errors="replace").strip()
            output_lines.append(line_str)
            _LOG.debug("Gateway: %s", line_str)

            # Parse "MACO Gateway listening on ('0.0.0.0', 12345)"
            if "listening on" in line_str.lower():
                # Extract port from the log message
                import re

                match = re.search(r"listening on.*[,:].*?(\d+)", line_str)
                if match:
                    self._actual_port = int(match.group(1))
                    _LOG.info("Gateway ready on port %d", self._actual_port)

                    # Start background task to drain remaining output
                    self._drain_task = asyncio.create_task(self._drain_output())
                    return

        raise RuntimeError(f"Gateway did not start within {timeout}s")

    async def _drain_output(self) -> None:
        """Drain and log gateway output."""
        if self._process is None or self._process.stdout is None:
            return

        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break
                _LOG.info("Gateway: %s", line.decode("utf-8", errors="replace").strip())
        except asyncio.CancelledError:
            pass

    async def stop(self) -> None:
        """Stop the gateway subprocess."""
        if self._process is None:
            return

        _LOG.info("Stopping gateway process")

        # Cancel drain task first
        if self._drain_task is not None:
            self._drain_task.cancel()
            try:
                await self._drain_task
            except asyncio.CancelledError:
                pass
            self._drain_task = None

        # Send SIGTERM
        try:
            self._process.terminate()
        except ProcessLookupError:
            pass

        # Wait for graceful shutdown
        try:
            await asyncio.wait_for(self._process.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            _LOG.warning("Gateway didn't stop gracefully, killing")
            try:
                self._process.kill()
            except ProcessLookupError:
                pass
            await self._process.wait()

        self._process = None
        self._actual_port = None
        _LOG.info("Gateway stopped")

    async def __aenter__(self) -> "GatewayProcess":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()
