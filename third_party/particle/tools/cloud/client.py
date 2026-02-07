# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Particle Cloud REST API client.

Provides a Python interface to the Particle Cloud REST API for operations
including device management, function calls, variable reads, and more.
"""

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_LOG = logging.getLogger(__name__)

# Particle Cloud API base URL
PARTICLE_API_BASE = "https://api.particle.io/v1"


class ParticleCloudError(Exception):
    """Raised when a Particle Cloud API request fails."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        response_body: Optional[str] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


@dataclass
class Device:
    """Represents a Particle device."""

    id: str
    name: str
    connected: bool
    platform_id: int
    product_id: Optional[int] = None
    last_heard: Optional[str] = None
    status: Optional[str] = None

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "Device":
        """Create Device from API response."""
        return cls(
            id=data["id"],
            name=data.get("name", ""),
            connected=data.get("connected", False),
            platform_id=data.get("platform_id", 0),
            product_id=data.get("product_id"),
            last_heard=data.get("last_heard"),
            status=data.get("status"),
        )


class ParticleCloudClient:
    """Client for Particle Cloud REST API.

    Usage:
        client = ParticleCloudClient()  # Uses PARTICLE_ACCESS_TOKEN env var
        # or
        client = ParticleCloudClient(access_token="my-token")

        devices = client.list_devices()
        result = client.call_function("my-device", "doSomething", "arg")
        value = client.get_variable("my-device", "temperature")
    """

    def __init__(
        self,
        access_token: Optional[str] = None,
        base_url: str = PARTICLE_API_BASE,
        timeout: float = 30.0,
        max_retries: int = 3,
    ):
        """Initialize the Particle Cloud client.

        Args:
            access_token: API access token. If None, reads from
                PARTICLE_ACCESS_TOKEN environment variable.
            base_url: API base URL.
            timeout: Default request timeout in seconds.
            max_retries: Maximum retry attempts for failed requests.

        Raises:
            ParticleCloudError: If no access token is available.
        """
        self._access_token = access_token or os.environ.get("PARTICLE_ACCESS_TOKEN")
        if not self._access_token:
            raise ParticleCloudError(
                "Access token required. Set PARTICLE_ACCESS_TOKEN environment "
                "variable or pass access_token parameter. "
                "Get a token via: particle token create"
            )

        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

        # Set up session with retry logic
        self._session = requests.Session()
        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=1.0,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST", "PUT", "DELETE"],
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self._session.mount("http://", adapter)
        self._session.mount("https://", adapter)
        self._session.headers.update(
            {"Authorization": f"Bearer {self._access_token}"}
        )

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> dict[str, Any]:
        """Make an API request.

        Args:
            method: HTTP method.
            path: API path (without base URL).
            params: Query parameters.
            json: JSON body data.
            timeout: Request timeout (uses default if None).

        Returns:
            Parsed JSON response.

        Raises:
            ParticleCloudError: If request fails.
        """
        url = f"{self._base_url}/{path.lstrip('/')}"
        timeout = timeout or self._timeout

        try:
            response = self._session.request(
                method,
                url,
                params=params,
                json=json,
                timeout=timeout,
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            body = e.response.text if e.response else ""
            raise ParticleCloudError(
                f"API request failed: {e}",
                status_code=e.response.status_code if e.response else None,
                response_body=body,
            ) from e
        except requests.exceptions.RequestException as e:
            raise ParticleCloudError(f"Request failed: {e}") from e

    # -- Device Operations --

    def list_devices(self) -> list[Device]:
        """List all devices accessible to this account.

        Returns:
            List of Device objects.
        """
        data = self._request("GET", "devices")
        return [Device.from_api(d) for d in data]

    def get_device(self, device_id_or_name: str) -> Device:
        """Get device details by ID or name.

        Args:
            device_id_or_name: Device ID or name.

        Returns:
            Device object.
        """
        # If it looks like a name, resolve to ID first
        device_id = self._resolve_device_id(device_id_or_name)
        data = self._request("GET", f"devices/{device_id}")
        return Device.from_api(data)

    def get_device_id(self, device_name: str) -> str:
        """Resolve device name to device ID.

        Args:
            device_name: Device name.

        Returns:
            Device ID string.

        Raises:
            ParticleCloudError: If device not found.
        """
        devices = self.list_devices()
        for device in devices:
            if device.name == device_name:
                return device.id
        raise ParticleCloudError(f"Device not found: {device_name}")

    def _resolve_device_id(self, device_id_or_name: str) -> str:
        """Resolve a device identifier to its ID.

        Device IDs are 24-character hex strings starting with 'e00'.

        Args:
            device_id_or_name: Device ID or name.

        Returns:
            Device ID string.
        """
        # Check if it looks like a device ID (24-char hex starting with e00)
        if (
            len(device_id_or_name) == 24
            and device_id_or_name.startswith("e00")
            and all(c in "0123456789abcdef" for c in device_id_or_name.lower())
        ):
            return device_id_or_name
        # Otherwise, treat as name and resolve
        return self.get_device_id(device_id_or_name)

    # -- Cloud Function Operations --

    def call_function(
        self,
        device: str,
        function_name: str,
        argument: str = "",
        timeout: Optional[float] = None,
    ) -> int:
        """Call a cloud function on a device.

        Args:
            device: Device name or ID.
            function_name: Name of the function to call.
            argument: String argument to pass.
            timeout: Request timeout in seconds.

        Returns:
            Integer return value from the function.
        """
        device_id = self._resolve_device_id(device)
        data = self._request(
            "POST",
            f"devices/{device_id}/{function_name}",
            json={"arg": argument},
            timeout=timeout,
        )
        return data.get("return_value", 0)

    def call_function_with_retry(
        self,
        device: str,
        function_name: str,
        argument: str = "",
        max_retries: int = 3,
        retry_delay: float = 2.0,
        timeout: Optional[float] = None,
    ) -> int:
        """Call a cloud function with retry on failure.

        Args:
            device: Device name or ID.
            function_name: Name of the function to call.
            argument: String argument to pass.
            max_retries: Maximum retry attempts.
            retry_delay: Delay between retries in seconds.
            timeout: Request timeout in seconds.

        Returns:
            Integer return value from the function.
        """
        last_error: Optional[Exception] = None
        for attempt in range(max_retries + 1):
            try:
                return self.call_function(device, function_name, argument, timeout)
            except ParticleCloudError as e:
                last_error = e
                if attempt < max_retries:
                    _LOG.warning(
                        "Function call attempt %d/%d failed: %s. Retrying...",
                        attempt + 1,
                        max_retries + 1,
                        str(e),
                    )
                    time.sleep(retry_delay)

        assert last_error is not None
        raise last_error

    # -- Cloud Variable Operations --

    def get_variable(
        self,
        device: str,
        variable_name: str,
        timeout: Optional[float] = None,
    ) -> Any:
        """Get a cloud variable from a device.

        Args:
            device: Device name or ID.
            variable_name: Name of the variable.
            timeout: Request timeout in seconds.

        Returns:
            Variable value (string, int, or double).
        """
        device_id = self._resolve_device_id(device)
        data = self._request(
            "GET",
            f"devices/{device_id}/{variable_name}",
            timeout=timeout,
        )
        return data.get("result")

    # -- Event Operations --

    def publish_event(
        self,
        event_name: str,
        data: str = "",
        private: bool = True,
        ttl: int = 60,
        timeout: Optional[float] = None,
    ) -> bool:
        """Publish an event to the cloud.

        Args:
            event_name: Event name.
            data: Event data payload.
            private: If True, publish as private event.
            ttl: Time-to-live in seconds.
            timeout: Request timeout in seconds.

        Returns:
            True if published successfully.
        """
        response = self._request(
            "POST",
            "devices/events",
            json={
                "name": event_name,
                "data": data,
                "private": private,
                "ttl": ttl,
            },
            timeout=timeout,
        )
        return response.get("ok", False)

    def close(self) -> None:
        """Close the HTTP session."""
        self._session.close()

    def __enter__(self) -> "ParticleCloudClient":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()
