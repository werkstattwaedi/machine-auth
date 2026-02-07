# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""TCP echo server fixture for integration tests.

Provides a simple TCP server that echoes all received data back to the client.
Used to test the ParticleTcpSocket on P2 hardware.
"""

import asyncio
import logging
import socket
from typing import Optional

_LOG = logging.getLogger(__name__)


class TcpEchoServerFixture:
    """Async TCP echo server for testing.

    This fixture starts a TCP server that echoes all received data back
    to the client. Useful for testing TCP client implementations.

    Example:
        server = TcpEchoServerFixture()
        await server.start()
        try:
            print(f"Echo server at {server.host}:{server.port}")
            # ... run tests ...
        finally:
            await server.stop()
    """

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 0,  # 0 = auto-assign
    ) -> None:
        """Initialize the TCP echo server.

        Args:
            host: Host to bind to. Use "0.0.0.0" to accept from any interface.
            port: Port to bind to. Use 0 for auto-assignment.
        """
        self._bind_host = host
        self._bind_port = port
        self._server: Optional[asyncio.Server] = None
        self._host: Optional[str] = None
        self._port: Optional[int] = None
        self._clients: list[asyncio.StreamWriter] = []

    async def start(self) -> None:
        """Start the echo server.

        After calling this, the host and port properties will be available.
        """
        if self._server is not None:
            raise RuntimeError("Server already started")

        self._server = await asyncio.start_server(
            self._handle_client,
            self._bind_host,
            self._bind_port,
        )

        # Get the actual bound address
        addr = self._server.sockets[0].getsockname()
        self._host = self._get_local_ip() if self._bind_host == "0.0.0.0" else addr[0]
        self._port = addr[1]

        _LOG.info("TCP echo server started at %s:%d", self._host, self._port)

    async def stop(self) -> None:
        """Stop the echo server and close all client connections."""
        if self._server is None:
            return

        # Close all client connections
        for writer in self._clients:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
        self._clients.clear()

        # Close the server
        self._server.close()
        await self._server.wait_closed()
        self._server = None
        _LOG.info("TCP echo server stopped")

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """Handle a connected client by echoing data back."""
        addr = writer.get_extra_info("peername")
        _LOG.debug("Client connected from %s", addr)
        self._clients.append(writer)

        try:
            while True:
                data = await reader.read(1024)
                if not data:
                    _LOG.debug("Client %s disconnected", addr)
                    break

                _LOG.debug("Received %d bytes from %s", len(data), addr)

                # Echo data back to client
                writer.write(data)
                await writer.drain()

        except asyncio.CancelledError:
            _LOG.info("Client handler cancelled for %s", addr)
        except Exception as e:
            _LOG.warning("Client %s error: %s", addr, e)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            if writer in self._clients:
                self._clients.remove(writer)

    @staticmethod
    def _get_local_ip() -> str:
        """Get the local IP address that can reach external hosts.

        This is used when binding to 0.0.0.0 to determine what IP
        the P2 device should connect to.

        Note: In WSL2, this returns the WSL2 internal IP which is NOT
        reachable from physical network devices. Use TCP_TEST_HOST env
        var to override with Windows host IP.
        """
        import os

        # Allow override via environment variable (useful for WSL2)
        override = os.environ.get("TCP_TEST_HOST")
        if override:
            return override

        # Check if running in WSL2
        try:
            with open("/proc/version", "r") as f:
                if "microsoft" in f.read().lower():
                    # Get Windows host IP (usually the default gateway in WSL2)
                    import subprocess
                    result = subprocess.run(
                        ["ip", "route", "show", "default"],
                        capture_output=True, text=True
                    )
                    win_ip = result.stdout.split()[2] if result.returncode == 0 else "unknown"
                    _LOG.warning(
                        "Running in WSL2 - P2 device cannot reach WSL2's internal IP. "
                        "Set TCP_TEST_HOST=%s and forward the port from Windows:\n"
                        "  netsh interface portproxy add v4tov4 listenport=<PORT> "
                        "listenaddress=0.0.0.0 connectport=<PORT> connectaddress=$(hostname -I)",
                        win_ip
                    )
        except Exception:
            pass

        # Create a UDP socket to determine the local IP
        # (no actual network traffic is sent)
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                # Connect to a public IP to determine which interface to use
                s.connect(("8.8.8.8", 80))
                return s.getsockname()[0]
        except Exception:
            # Fallback to localhost
            return "127.0.0.1"

    @property
    def host(self) -> str:
        """Get the server host address.

        Raises:
            RuntimeError: If server is not started.
        """
        if self._host is None:
            raise RuntimeError("Server not started")
        return self._host

    @property
    def port(self) -> int:
        """Get the server port.

        Raises:
            RuntimeError: If server is not started.
        """
        if self._port is None:
            raise RuntimeError("Server not started")
        return self._port

    async def __aenter__(self) -> "TcpEchoServerFixture":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()


class LatchingTcpEchoServer:
    """TCP echo server that holds responses until released.

    This server receives data from clients but doesn't echo it back until
    explicitly released. Useful for testing concurrent request handling.

    Example:
        server = LatchingTcpEchoServer(port=19284)
        await server.start()

        # Clients connect and send data...
        # Server holds responses

        # Wait for expected number of pending responses
        await server.wait_for_pending(count=2, timeout=5.0)

        # Release all held responses
        await server.release_all()

        # Clients now receive their echoed data
    """

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 0,
    ) -> None:
        self._bind_host = host
        self._bind_port = port
        self._server: Optional[asyncio.Server] = None
        self._host: Optional[str] = None
        self._port: Optional[int] = None

        # Pending responses: list of (writer, data) tuples
        self._pending: list[tuple[asyncio.StreamWriter, bytes]] = []
        self._pending_lock = asyncio.Lock()
        self._pending_event = asyncio.Event()

        # Client handlers
        self._clients: list[asyncio.StreamWriter] = []

    async def start(self) -> None:
        """Start the latching echo server."""
        if self._server is not None:
            raise RuntimeError("Server already started")

        self._server = await asyncio.start_server(
            self._handle_client,
            self._bind_host,
            self._bind_port,
        )

        addr = self._server.sockets[0].getsockname()
        self._host = TcpEchoServerFixture._get_local_ip() if self._bind_host == "0.0.0.0" else addr[0]
        self._port = addr[1]

        _LOG.info("Latching TCP echo server started at %s:%d", self._host, self._port)

    async def stop(self) -> None:
        """Stop the server and close all connections."""
        if self._server is None:
            return

        for writer in self._clients:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
        self._clients.clear()
        self._pending.clear()

        self._server.close()
        await self._server.wait_closed()
        self._server = None
        _LOG.info("Latching TCP echo server stopped")

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """Handle client by receiving data and holding it until released."""
        addr = writer.get_extra_info("peername")
        _LOG.debug("Latching server: client connected from %s", addr)
        self._clients.append(writer)

        try:
            while True:
                data = await reader.read(1024)
                if not data:
                    _LOG.debug("Latching server: client %s disconnected", addr)
                    break

                _LOG.debug("Latching server: received %d bytes from %s, holding", len(data), addr)

                # Hold the response instead of echoing immediately
                async with self._pending_lock:
                    self._pending.append((writer, data))
                    self._pending_event.set()

        except asyncio.CancelledError:
            _LOG.info("Latching server: client handler cancelled for %s", addr)
        except Exception as e:
            _LOG.warning("Latching server: client %s error: %s", addr, e)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            if writer in self._clients:
                self._clients.remove(writer)

    async def wait_for_pending(self, count: int, timeout: float = 5.0) -> bool:
        """Wait until at least `count` responses are pending.

        Args:
            count: Number of pending responses to wait for.
            timeout: Maximum time to wait in seconds.

        Returns:
            True if count was reached, False if timeout.
        """
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            async with self._pending_lock:
                if len(self._pending) >= count:
                    return True

            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                return False

            self._pending_event.clear()
            try:
                await asyncio.wait_for(self._pending_event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                return False

    async def release_all(self) -> int:
        """Release all pending responses (echo them back).

        Returns:
            Number of responses released.
        """
        async with self._pending_lock:
            count = len(self._pending)
            for writer, data in self._pending:
                try:
                    _LOG.debug("Latching server: releasing %d bytes", len(data))
                    writer.write(data)
                    await writer.drain()
                except Exception as e:
                    _LOG.warning("Latching server: failed to send response: %s", e)
            self._pending.clear()
            return count

    @property
    def pending_count(self) -> int:
        """Get the number of pending responses."""
        return len(self._pending)

    @property
    def host(self) -> str:
        if self._host is None:
            raise RuntimeError("Server not started")
        return self._host

    @property
    def port(self) -> int:
        if self._port is None:
            raise RuntimeError("Server not started")
        return self._port

    async def __aenter__(self) -> "LatchingTcpEchoServer":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()
