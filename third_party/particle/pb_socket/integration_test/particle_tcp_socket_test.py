# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""ParticleTcpSocket integration tests.

These tests run on real P2 hardware with a TCP echo server to verify
the ParticleTcpSocket implementation end-to-end.

Architecture:
    Python Test → TcpEchoServer (on host)
                       ↑
    P2 Device → ParticleTcpSocket → TCP connection → host
"""

import asyncio
import logging
import sys
import threading
import time
import unittest
from pathlib import Path

# Configure logging to see device logs
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s %(name)s %(levelname)s: %(message)s',
    stream=sys.stdout,
    force=True,  # Override any existing config
)
# Enable device logs specifically
logging.getLogger('rpc_device').setLevel(logging.DEBUG)
logging.getLogger('pw_system').setLevel(logging.DEBUG)

from pb_integration_tests.harness import P2DeviceFixture, IntegrationTestHarness
from tcp_echo_server import TcpEchoServerFixture, LatchingTcpEchoServer

# Import pre-compiled proto modules
import particle_tcp_socket_test_pb2
from pw_log.proto import log_pb2

# Resolve firmware paths relative to this test file's directory
_TEST_DIR = Path(__file__).parent
FIRMWARE_BIN = _TEST_DIR / "particle_tcp_socket_test_firmware.bin.bin"
FIRMWARE_ELF = _TEST_DIR / "particle_tcp_socket_test_firmware"


class ParticleTcpSocketIntegrationTest(unittest.IsolatedAsyncioTestCase):
    """Integration tests for ParticleTcpSocket on P2 hardware."""

    # Class-level fixtures (shared across all tests)
    harness: IntegrationTestHarness
    echo_server: TcpEchoServerFixture
    device: P2DeviceFixture

    # Class-level state for background echo server
    _echo_loop: asyncio.AbstractEventLoop
    _echo_thread: "threading.Thread"

    @classmethod
    def setUpClass(cls):
        """Set up test environment once for all tests."""
        cls.harness = IntegrationTestHarness()

        # TCP echo server (on host machine)
        # Use fixed port 19283 to simplify WSL2 port forwarding setup
        # Run in background thread with its own event loop (so it persists)
        cls.echo_server = TcpEchoServerFixture(port=19283)
        cls.harness.add_fixture("echo_server", cls.echo_server)

        # Start echo server in background thread
        cls._echo_loop = asyncio.new_event_loop()
        cls._echo_thread = threading.Thread(
            target=cls._run_echo_server,
            daemon=True
        )
        cls._echo_thread.start()

        # Wait for server to be ready
        for _ in range(50):  # 5 second timeout
            if cls.echo_server._server is not None:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Echo server failed to start")

        print(f"\n=== Echo server listening at {cls.echo_server.host}:{cls.echo_server.port} ===", flush=True)

        # Create and start device fixture
        cls.device = P2DeviceFixture(
            firmware_bin=FIRMWARE_BIN,
            firmware_elf=FIRMWARE_ELF,
            proto_paths=[particle_tcp_socket_test_pb2, log_pb2],
        )
        cls.harness.add_fixture("device", cls.device)
        asyncio.run(cls.device.start())

        # Wait for device to connect to cloud (WiFi) via RPC
        # After flashing, the device needs time to reconnect to WiFi
        print("Waiting for device to connect to cloud...", flush=True)
        response = cls.device.rpc.rpcs.maco.test.socket.TestControl.WaitForCloud(
            timeout_ms=60000,
            pw_rpc_timeout_s=65.0,  # RPC timeout must exceed the internal wait
        )
        if not response.response.connected:
            raise RuntimeError("Device failed to connect to cloud within 60 seconds")
        print("Device connected to cloud!", flush=True)

    @classmethod
    def _run_echo_server(cls):
        """Run echo server in background thread."""
        asyncio.set_event_loop(cls._echo_loop)
        cls._echo_loop.run_until_complete(cls.echo_server.start())
        cls._echo_loop.run_forever()

    @classmethod
    def tearDownClass(cls):
        """Clean up test environment after all tests."""
        # Stop device
        asyncio.run(cls.device.stop())

        # Stop echo server
        cls._echo_loop.call_soon_threadsafe(cls._echo_loop.stop)
        cls._echo_thread.join(timeout=5.0)

    def tearDown(self):
        """Clean up after each test (disconnect without reflashing)."""
        # Ensure TCP client is disconnected between tests
        try:
            self._disconnect()
        except Exception:
            pass  # Ignore errors if already disconnected

    def _configure(self, host: str, port: int, connect_timeout_ms: int = 10000):
        """Configure the TCP socket on the device."""
        response = self.device.rpc.rpcs.maco.test.socket.TestControl.Configure(
            host=host,
            port=port,
            connect_timeout_ms=connect_timeout_ms,
            read_timeout_ms=5000,
        )
        return response.response

    def _connect(self, pw_rpc_timeout_s=5.0):
        """Connect to the configured server."""
        response = self.device.rpc.rpcs.maco.test.socket.TestControl.Connect(
            pw_rpc_timeout_s=pw_rpc_timeout_s,
        )
        return response.response

    def _write_data(self, data: bytes):
        """Write data to the socket."""
        response = self.device.rpc.rpcs.maco.test.socket.TestControl.WriteData(
            data=data
        )
        return response.response

    def _read_data(self, max_bytes: int = 256, timeout_ms: int = 5000):
        """Read data from the socket."""
        response = self.device.rpc.rpcs.maco.test.socket.TestControl.ReadData(
            max_bytes=max_bytes,
            timeout_ms=timeout_ms,
        )
        return response.response

    def _disconnect(self):
        """Disconnect from the server."""
        response = self.device.rpc.rpcs.maco.test.socket.TestControl.Disconnect()
        return response.response

    def _get_state(self):
        """Get current connection state."""
        response = self.device.rpc.rpcs.maco.test.socket.TestControl.GetState()
        return response.response

    async def test_aaa_simple_write(self):
        """Test simple connect + write (runs first alphabetically)."""
        print("=== Starting simple write test ===", flush=True)

        # Configure
        print("Configuring...", flush=True)
        result = self._configure(self.echo_server.host, self.echo_server.port)
        self.assertTrue(result.success)
        print("Configure OK", flush=True)

        # Connect
        print("Connecting...", flush=True)
        result = self._connect()
        self.assertTrue(result.success, f"Connect failed: {result.error}")
        print("Connect OK", flush=True)

        # Write
        print("Writing 'test'...", flush=True)
        result = self._write_data(b"test")
        print(f"Write returned: success={result.success}", flush=True)
        self.assertTrue(result.success, f"Write failed: {result.error}")

        # Clean up
        self._disconnect()
        print("=== Simple write test PASSED ===", flush=True)

    async def test_connect_success(self):
        """Test successful connection to echo server."""
        # Configure with echo server address
        result = self._configure(self.echo_server.host, self.echo_server.port)
        self.assertTrue(result.success)

        # Connect
        result = self._connect()
        self.assertTrue(result.success, f"Connect failed: {result.error}")
        self.assertEqual(
            result.state, particle_tcp_socket_test_pb2.TCP_STATE_CONNECTED
        )

        # Verify state
        state = self._get_state()
        self.assertTrue(state.is_connected)
        self.assertEqual(state.state, particle_tcp_socket_test_pb2.TCP_STATE_CONNECTED)

        # Clean up
        self._disconnect()

    async def test_echo_round_trip(self):
        """Test write/read echo round trip."""
        # Connect
        self._configure(self.echo_server.host, self.echo_server.port)
        result = self._connect()
        self.assertTrue(result.success, f"Connect failed: {result.error}")

        # Write data
        test_data = b"Hello from P2!"
        result = self._write_data(test_data)
        self.assertTrue(result.success, f"Write failed: {result.error}")
        self.assertEqual(result.bytes_written, len(test_data))

        # Small delay to allow echo server to respond
        await asyncio.sleep(0.1)

        # Read echoed data
        result = self._read_data(max_bytes=len(test_data))
        self.assertTrue(result.success, f"Read failed: {result.error}")
        self.assertEqual(result.data, test_data)

        # Clean up
        self._disconnect()

    async def test_echo_multiple_writes(self):
        """Test multiple write/read cycles."""
        # Connect
        self._configure(self.echo_server.host, self.echo_server.port)
        result = self._connect()
        self.assertTrue(result.success)

        messages = [b"Message 1", b"Message 2", b"Third message"]

        for msg in messages:
            result = self._write_data(msg)
            self.assertTrue(result.success)

            await asyncio.sleep(0.1)

            result = self._read_data(max_bytes=len(msg))
            self.assertTrue(result.success)
            self.assertEqual(result.data, msg)

        # Clean up
        self._disconnect()

    async def test_disconnect(self):
        """Test clean disconnect."""
        # Connect
        self._configure(self.echo_server.host, self.echo_server.port)
        result = self._connect()
        self.assertTrue(result.success)

        # Verify connected
        state = self._get_state()
        self.assertTrue(state.is_connected)

        # Disconnect
        result = self._disconnect()
        self.assertTrue(result.success)
        self.assertEqual(result.state, particle_tcp_socket_test_pb2.TCP_STATE_DISCONNECTED)

        # Verify disconnected
        state = self._get_state()
        self.assertFalse(state.is_connected)
        self.assertEqual(state.state, particle_tcp_socket_test_pb2.TCP_STATE_DISCONNECTED)

    async def test_connect_timeout(self):
        """Test connection timeout to unreachable host."""
        # Configure with unreachable IP (non-routable IP in TEST-NET-1)
        # Use short timeout so test doesn't take too long
        self._configure(
            host="192.0.2.1",  # TEST-NET-1, guaranteed unreachable
            port=12345,
            connect_timeout_ms=3000,  # 3 second timeout
        )

        # Connect should fail with timeout.
        # RPC timeout must exceed the device-side connect timeout (LwIP may
        # enforce a minimum longer than the configured value).
        result = self._connect(pw_rpc_timeout_s=10.0)
        self.assertFalse(result.success)
        # State should be error or disconnected
        self.assertIn(
            result.state,
            [
                particle_tcp_socket_test_pb2.TCP_STATE_ERROR,
                particle_tcp_socket_test_pb2.TCP_STATE_DISCONNECTED,
            ],
        )

    async def test_write_without_connect(self):
        """Test that write fails when not connected."""
        # Configure but don't connect
        self._configure(self.echo_server.host, self.echo_server.port)

        # Write should fail
        result = self._write_data(b"test")
        self.assertFalse(result.success)
        self.assertIn("Not connected", result.error)

    async def test_read_without_connect(self):
        """Test that read fails when not connected."""
        # Configure but don't connect
        self._configure(self.echo_server.host, self.echo_server.port)

        # Read should fail
        result = self._read_data(max_bytes=10)
        self.assertFalse(result.success)
        self.assertIn("Not connected", result.error)

    @unittest.skip("Not yet implemented")
    async def test_concurrent_inflight_requests(self):
        """Test concurrent requests from two sockets with latched server responses.

        This test verifies that when two ParticleTcpSocket instances queue
        requests through the shared socket worker thread, each socket receives
        the correct response back.

        The latching server holds responses until both requests arrive, ensuring
        both writes are truly "in flight" at the same time.
        """
        print("=== Starting concurrent inflight requests test ===", flush=True)

        # Start a latching server on a different port
        latching_server = LatchingTcpEchoServer(port=19284)

        # Run in background thread like the main echo server
        latching_loop = asyncio.new_event_loop()

        def run_latching_server():
            asyncio.set_event_loop(latching_loop)
            latching_loop.run_until_complete(latching_server.start())
            latching_loop.run_forever()

        latching_thread = threading.Thread(target=run_latching_server, daemon=True)
        latching_thread.start()

        # Wait for server to start
        for _ in range(50):
            if latching_server._server is not None:
                break
            time.sleep(0.1)
        else:
            self.fail("Latching server failed to start")

        print(f"Latching server listening at {latching_server.host}:{latching_server.port}", flush=True)

        # Give the server a moment to fully initialize
        time.sleep(0.5)

        try:
            # Define unique data for each socket
            data1 = b"SOCKET_ONE_DATA_AAA"
            data2 = b"SOCKET_TWO_DATA_BBB"

            # Create a future to release the latched responses
            async def wait_and_release():
                """Wait for both requests then release after a delay."""
                print("Waiting for 2 pending requests...", flush=True)
                success = await latching_server.wait_for_pending(count=2, timeout=10.0)
                if success:
                    print(f"Got {latching_server.pending_count} pending requests, releasing after delay", flush=True)
                    await asyncio.sleep(0.5)  # Hold briefly to ensure both are queued
                    released = await latching_server.release_all()
                    print(f"Released {released} responses", flush=True)
                else:
                    print("Timeout waiting for pending requests!", flush=True)

            # Schedule the release in the latching server's event loop
            asyncio.run_coroutine_threadsafe(wait_and_release(), latching_loop)

            # Call the concurrent write test RPC
            print("Calling ConcurrentWriteTest RPC...", flush=True)
            response = self.device.rpc.rpcs.maco.test.socket.TestControl.ConcurrentWriteTest(
                host=latching_server.host,
                port=latching_server.port,
                data1=data1,
                data2=data2,
                pw_rpc_timeout_s=30.0,
            )

            result = response.response
            print(f"ConcurrentWriteTest result: success={result.success}, "
                  f"socket1_correct={result.socket1_correct}, "
                  f"socket2_correct={result.socket2_correct}", flush=True)

            if not result.success:
                print(f"Error: {result.error}", flush=True)
                print(f"Received1: {bytes(result.received1)}", flush=True)
                print(f"Received2: {bytes(result.received2)}", flush=True)

            self.assertTrue(result.success, f"Concurrent write test failed: {result.error}")
            self.assertTrue(result.socket1_correct, "Socket 1 received wrong data")
            self.assertTrue(result.socket2_correct, "Socket 2 received wrong data")
            self.assertEqual(bytes(result.received1), data1)
            self.assertEqual(bytes(result.received2), data2)

            print("=== Concurrent inflight requests test PASSED ===", flush=True)

        finally:
            # Stop the latching server
            latching_loop.call_soon_threadsafe(latching_loop.stop)
            latching_thread.join(timeout=5.0)


if __name__ == "__main__":
    unittest.main()
