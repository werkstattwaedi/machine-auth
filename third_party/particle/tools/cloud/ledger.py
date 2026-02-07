# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Particle Cloud Ledger API operations.

Provides Python functions for interacting with Particle Cloud Ledger,
a key-value store for device configuration and state synchronization.
"""

import logging
from typing import Any, Optional

from .client import ParticleCloudClient, ParticleCloudError

_LOG = logging.getLogger(__name__)


class LedgerClient:
    """Client for Particle Cloud Ledger operations.

    Ledger provides cloud-to-device and device-to-cloud synchronized
    key-value storage for device configuration and state.

    Usage:
        client = LedgerClient()  # Uses PARTICLE_ACCESS_TOKEN env var
        # or
        client = LedgerClient(cloud_client=existing_client)

        # Get ledger data
        data = client.get("my-device", "terminal-config")

        # Set ledger data (cloud-to-device ledgers only)
        client.set("my-device", "terminal-config", {"enabled": True})
    """

    def __init__(
        self,
        cloud_client: Optional[ParticleCloudClient] = None,
        access_token: Optional[str] = None,
    ):
        """Initialize the Ledger client.

        Args:
            cloud_client: Existing ParticleCloudClient to use.
            access_token: API access token (only used if cloud_client is None).
        """
        self._owns_client = cloud_client is None
        self._client = cloud_client or ParticleCloudClient(access_token=access_token)

    def get(
        self,
        device: str,
        ledger_name: str,
        scope: str = "device",
        timeout: Optional[float] = None,
    ) -> dict[str, Any]:
        """Get ledger data from the Particle Cloud.

        Args:
            device: Device name or ID.
            ledger_name: Name of the ledger.
            scope: Ledger scope ("device" or "product").
            timeout: Request timeout in seconds.

        Returns:
            Dictionary of ledger data.

        Raises:
            ParticleCloudError: If the request fails.
        """
        device_id = self._client._resolve_device_id(device)

        _LOG.info("Getting ledger '%s' from device %s", ledger_name, device_id)

        result = self._client._request(
            "GET",
            f"devices/{device_id}/ledger/{ledger_name}",
            params={"scope": scope},
            timeout=timeout,
        )

        data = result.get("data", {})
        _LOG.debug("Ledger data: %s", data)
        return data

    def set(
        self,
        device: str,
        ledger_name: str,
        data: dict[str, Any],
        scope: str = "device",
        timeout: Optional[float] = None,
    ) -> None:
        """Set ledger data on the Particle Cloud.

        Note: This only works for cloud-to-device ledgers.

        Args:
            device: Device name or ID.
            ledger_name: Name of the ledger.
            data: Dictionary of data to write.
            scope: Ledger scope ("device" or "product").
            timeout: Request timeout in seconds.

        Raises:
            ParticleCloudError: If the request fails.
        """
        device_id = self._client._resolve_device_id(device)

        _LOG.info(
            "Setting ledger '%s' on device %s to %s",
            ledger_name,
            device_id,
            data,
        )

        self._client._request(
            "PUT",
            f"devices/{device_id}/ledger/{ledger_name}",
            params={"scope": scope},
            json={"data": data},
            timeout=timeout,
        )

        _LOG.info("Ledger updated successfully")

    def delete(
        self,
        device: str,
        ledger_name: str,
        scope: str = "device",
        timeout: Optional[float] = None,
    ) -> None:
        """Delete ledger data from the Particle Cloud.

        Args:
            device: Device name or ID.
            ledger_name: Name of the ledger.
            scope: Ledger scope ("device" or "product").
            timeout: Request timeout in seconds.

        Raises:
            ParticleCloudError: If the request fails.
        """
        device_id = self._client._resolve_device_id(device)

        _LOG.info("Deleting ledger '%s' from device %s", ledger_name, device_id)

        self._client._request(
            "DELETE",
            f"devices/{device_id}/ledger/{ledger_name}",
            params={"scope": scope},
            timeout=timeout,
        )

        _LOG.info("Ledger deleted successfully")

    def close(self) -> None:
        """Close resources."""
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "LedgerClient":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()


# Convenience functions for backward compatibility

def ledger_get(
    device: str,
    ledger_name: str,
    scope: str = "device",
) -> dict[str, Any]:
    """Get ledger data from the Particle Cloud.

    Args:
        device: Device name or ID.
        ledger_name: Name of the ledger.
        scope: Ledger scope ("device" or "product").

    Returns:
        Dictionary of ledger data.
    """
    with LedgerClient() as client:
        return client.get(device, ledger_name, scope)


def ledger_set(
    device: str,
    ledger_name: str,
    data: dict[str, Any],
    scope: str = "device",
) -> None:
    """Set ledger data on the Particle Cloud.

    Args:
        device: Device name or ID.
        ledger_name: Name of the ledger.
        data: Dictionary of data to write.
        scope: Ledger scope ("device" or "product").
    """
    with LedgerClient() as client:
        client.set(device, ledger_name, data, scope)


def ledger_delete(
    device: str,
    ledger_name: str,
    scope: str = "device",
) -> None:
    """Delete ledger data from the Particle Cloud.

    Args:
        device: Device name or ID.
        ledger_name: Name of the ledger.
        scope: Ledger scope ("device" or "product").
    """
    with LedgerClient() as client:
        client.delete(device, ledger_name, scope)
