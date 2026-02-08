# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Firebase client integration tests.

These tests run on real P2 hardware with a real gateway to verify
the firmware's Firebase client behavior end-to-end.

Architecture:
    P2 Device → Real Gateway → MockHttpServer

The MockHttpServer returns canned protobuf responses, allowing tests
to simulate Firebase Cloud Function behavior.
"""

import asyncio
import logging
import os
import unittest
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
_LOG = logging.getLogger(__name__)

from maco_gateway.fixtures import MockHttpServer, GatewayProcess, CannedResponse
from pb_integration_tests.harness import P2DeviceFixture, IntegrationTestHarness

# Import pre-compiled proto module
import firebase_client_test_pb2

# Paths to firmware (relative to runfiles)
FIRMWARE_BIN = Path(
    "maco_firmware/modules/firebase/integration_test/"
    "firebase_client_test_firmware.bin.bin"
)
FIRMWARE_ELF = Path(
    "maco_firmware/modules/firebase/integration_test/"
    "firebase_client_test_firmware"
)


class FirebaseClientIntegrationTest(unittest.IsolatedAsyncioTestCase):
    """Integration tests for Firebase client on P2 hardware."""

    async def asyncSetUp(self):
        """Set up test environment with device and gateway."""
        self.harness = IntegrationTestHarness()

        # Mock HTTP server (simulates Firebase Cloud Functions)
        self.mock_server = MockHttpServer()

        # Real gateway process (forwards device requests to mock server)
        # Note: GatewayProcess needs mock_server.url, so start mock first
        self.harness.add_fixture("mock_server", self.mock_server)

        # Start mock server to get its URL
        await self.mock_server.start()

        # Now create gateway with mock server URL
        # Listen on 0.0.0.0:19283 so P2 can reach us via port forwarding (WSL2)
        self.gateway = GatewayProcess(
            firebase_url=self.mock_server.url,
            host="0.0.0.0",
            port=19283,
        )
        self.harness.add_fixture("gateway", self.gateway)

        # Create device fixture with test firmware
        self.device = P2DeviceFixture(
            firmware_bin=FIRMWARE_BIN,
            firmware_elf=FIRMWARE_ELF,  # For log detokenization
            proto_paths=[firebase_client_test_pb2],
        )
        self.harness.add_fixture("device", self.device)

        # Start remaining fixtures (gateway, device)
        await self.gateway.start()
        await self.device.start()

        # Test basic RPC connectivity first
        _LOG.info("Testing RPC connectivity with Ping...")
        ping_result = self.device.rpc.rpcs.maco.test.firebase.TestControl.Ping()
        _LOG.info("Ping result: %s", ping_result)

        # Wait for WiFi before configuring gateway
        _LOG.info("Waiting for device WiFi connection...")
        wifi_result = self.device.rpc.rpcs.maco.test.firebase.TestControl.WaitForWiFi(
            timeout_ms=30000,
            pw_rpc_timeout_s=35.0,
        )
        if not wifi_result.response.connected:
            raise RuntimeError("Device failed to connect to WiFi within 30 seconds")
        _LOG.info("Device WiFi ready!")

        # Configure device to connect to gateway
        # TCP_TEST_HOST: IP the P2 uses to reach us (required on WSL2)
        device_host = os.environ.get("TCP_TEST_HOST", self.gateway.host)
        device_port = self.gateway.port
        _LOG.info("Calling ConfigureGateway(host=%s, port=%d)...", device_host, device_port)
        self.device.rpc.rpcs.maco.test.firebase.TestControl.ConfigureGateway(
            host=device_host,
            port=device_port,
        )

    async def asyncTearDown(self):
        """Clean up test environment."""
        # Stop fixtures in reverse order (device, gateway, mock_server)
        # Note: We started these manually, not via harness.start(),
        # so we need to stop them manually too.
        await self.device.stop()
        await self.gateway.stop()
        await self.mock_server.stop()

    async def test_terminal_checkin_unimplemented(self):
        """Test that TerminalCheckin returns an error from the gateway.

        The gateway currently returns UNIMPLEMENTED for all RPCs.
        This test verifies the full end-to-end path:
        P2 → HDLC/ASCON → Gateway → UNIMPLEMENTED response → P2.
        """
        response = self.device.rpc.rpcs.maco.test.firebase.TestControl.TriggerStartSession(
            tag_uid=b"\x04\x01\x02\x03\x04\x05\x06",
            pw_rpc_timeout_s=15.0,
        )
        result = response.response

        # Gateway returns UNIMPLEMENTED, which the device maps to an error
        self.assertFalse(result.success)
        self.assertIn("RPC failed", result.error)


# Future tests to implement:
#
# async def test_start_session_auth_required(self):
#     """Test StartSession returns auth_required for unregistered tag."""
#     # Configure mock server to return auth_required response
#     self.mock_server.set_response("/api/startSession", CannedResponse(
#         payload=start_session_auth_required_pb.SerializeToString(),
#     ))
#
#     result = self.device.rpc.rpcs.maco.test.firebase.TestControl.TriggerStartSession(
#         tag_uid=b'\x04\x01\x02\x03\x04\x05\x06',
#     )
#
#     self.assertTrue(result.response.success)
#     self.assertTrue(result.response.auth_required)
#
#
# async def test_start_session_active_session(self):
#     """Test StartSession returns session info for registered tag."""
#     self.mock_server.set_response("/api/startSession", CannedResponse(
#         payload=start_session_success_pb.SerializeToString(),
#     ))
#
#     result = self.device.rpc.rpcs.maco.test.firebase.TestControl.TriggerStartSession(
#         tag_uid=b'\x04\x01\x02\x03\x04\x05\x06',
#     )
#
#     self.assertTrue(result.response.success)
#     self.assertFalse(result.response.auth_required)
#     self.assertEqual(result.response.session_id, "abc123")


if __name__ == "__main__":
    unittest.main()
