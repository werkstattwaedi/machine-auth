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
import unittest
from pathlib import Path

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
        self.gateway = GatewayProcess(firebase_url=self.mock_server.url)
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

        # Configure device to connect to gateway
        # Note: pw_rpc calls are synchronous (callback-based), not async
        self.device.rpc.rpcs.maco.test.firebase.TestControl.ConfigureGateway(
            host=self.gateway.host,
            port=self.gateway.port,
        )

    async def asyncTearDown(self):
        """Clean up test environment."""
        # Stop fixtures in reverse order (device, gateway, mock_server)
        # Note: We started these manually, not via harness.start(),
        # so we need to stop them manually too.
        await self.device.stop()
        await self.gateway.stop()
        await self.mock_server.stop()

    async def test_start_session_not_implemented_yet(self):
        """Test that TriggerStartSession returns 'not implemented' for now.

        This is a placeholder test to verify the integration test framework
        is working. The actual implementation will come later.
        """
        # Trigger a StartSession call
        # Note: pw_rpc calls are synchronous (callback-based), not async
        response = self.device.rpc.rpcs.maco.test.firebase.TestControl.TriggerStartSession(
            tag_uid=b"\x04\x01\x02\x03\x04\x05\x06",
        )
        result = response.response

        # For now, expect "not implemented" response
        self.assertFalse(result.success)
        self.assertIn("Not yet implemented", result.error)


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
