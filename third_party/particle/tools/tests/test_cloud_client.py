# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Unit tests for Particle Cloud client."""

import json
import os
import unittest
from unittest.mock import MagicMock, patch

# Set up environment before imports
os.environ.setdefault("PARTICLE_ACCESS_TOKEN", "test-token")

from tools.cloud.client import (
    Device,
    ParticleCloudClient,
    ParticleCloudError,
)


class TestDevice(unittest.TestCase):
    """Tests for Device dataclass."""

    def test_from_api_minimal(self):
        """Test creating Device from minimal API response."""
        data = {"id": "abc123", "connected": True, "platform_id": 32}
        device = Device.from_api(data)

        self.assertEqual(device.id, "abc123")
        self.assertEqual(device.name, "")
        self.assertTrue(device.connected)
        self.assertEqual(device.platform_id, 32)

    def test_from_api_full(self):
        """Test creating Device from full API response."""
        data = {
            "id": "e00fce68deadbeef12345678",
            "name": "my-device",
            "connected": True,
            "platform_id": 32,
            "product_id": 12345,
            "last_heard": "2024-01-01T00:00:00.000Z",
            "status": "normal",
        }
        device = Device.from_api(data)

        self.assertEqual(device.id, "e00fce68deadbeef12345678")
        self.assertEqual(device.name, "my-device")
        self.assertTrue(device.connected)
        self.assertEqual(device.platform_id, 32)
        self.assertEqual(device.product_id, 12345)


class TestParticleCloudClient(unittest.TestCase):
    """Tests for ParticleCloudClient."""

    def test_init_with_token(self):
        """Test initialization with explicit token."""
        client = ParticleCloudClient(access_token="my-token")
        self.assertIsNotNone(client)
        client.close()

    def test_init_from_env(self):
        """Test initialization from environment variable."""
        with patch.dict(os.environ, {"PARTICLE_ACCESS_TOKEN": "env-token"}):
            client = ParticleCloudClient()
            self.assertIsNotNone(client)
            client.close()

    def test_init_no_token_raises(self):
        """Test that missing token raises error."""
        with patch.dict(os.environ, {}, clear=True):
            # Remove any existing token
            os.environ.pop("PARTICLE_ACCESS_TOKEN", None)
            with self.assertRaises(ParticleCloudError) as ctx:
                ParticleCloudClient()
            self.assertIn("Access token required", str(ctx.exception))

    @patch("tools.cloud.client.requests.Session")
    def test_list_devices(self, mock_session_class):
        """Test listing devices."""
        # Set up mock
        mock_session = MagicMock()
        mock_session_class.return_value = mock_session

        mock_response = MagicMock()
        mock_response.json.return_value = [
            {"id": "device1", "name": "dev1", "connected": True, "platform_id": 32},
            {"id": "device2", "name": "dev2", "connected": False, "platform_id": 32},
        ]
        mock_response.raise_for_status = MagicMock()
        mock_session.request.return_value = mock_response

        client = ParticleCloudClient(access_token="test-token")
        devices = client.list_devices()

        self.assertEqual(len(devices), 2)
        self.assertEqual(devices[0].id, "device1")
        self.assertEqual(devices[0].name, "dev1")
        self.assertTrue(devices[0].connected)
        self.assertEqual(devices[1].id, "device2")
        self.assertFalse(devices[1].connected)

        client.close()

    @patch("tools.cloud.client.requests.Session")
    def test_call_function(self, mock_session_class):
        """Test calling a cloud function."""
        mock_session = MagicMock()
        mock_session_class.return_value = mock_session

        mock_response = MagicMock()
        mock_response.json.return_value = {"return_value": 42}
        mock_response.raise_for_status = MagicMock()
        mock_session.request.return_value = mock_response

        client = ParticleCloudClient(access_token="test-token")
        result = client.call_function(
            "e00fce68deadbeef12345678", "testFunc", "arg"
        )

        self.assertEqual(result, 42)

        # Verify request
        mock_session.request.assert_called_once()
        call_args = mock_session.request.call_args
        self.assertEqual(call_args[0][0], "POST")
        self.assertIn("testFunc", call_args[0][1])
        self.assertEqual(call_args[1]["json"], {"arg": "arg"})

        client.close()

    @patch("tools.cloud.client.requests.Session")
    def test_get_variable(self, mock_session_class):
        """Test getting a cloud variable."""
        mock_session = MagicMock()
        mock_session_class.return_value = mock_session

        mock_response = MagicMock()
        mock_response.json.return_value = {"result": "hello world"}
        mock_response.raise_for_status = MagicMock()
        mock_session.request.return_value = mock_response

        client = ParticleCloudClient(access_token="test-token")
        result = client.get_variable(
            "e00fce68deadbeef12345678", "greeting"
        )

        self.assertEqual(result, "hello world")
        client.close()

    def test_resolve_device_id_with_id(self):
        """Test that device IDs pass through unchanged."""
        client = ParticleCloudClient(access_token="test-token")
        device_id = "e00fce68deadbeef12345678"
        resolved = client._resolve_device_id(device_id)
        self.assertEqual(resolved, device_id)
        client.close()


if __name__ == "__main__":
    unittest.main()
