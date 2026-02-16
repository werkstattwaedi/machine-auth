# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Firebase Cloud Functions HTTP client.

Forwards requests from MACO devices to Firebase Cloud Functions via HTTPS.
The client handles:
- HTTP POST requests to Firebase endpoints
- Protobuf payloads (opaque bytes)
- Authorization via GATEWAY_API_KEY
- Device identification via X-Device-Id header
- Error handling and response formatting
"""

import base64
import json
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class ForwardResult:
    """Result of a Firebase forward request."""

    success: bool
    payload: bytes
    http_status: int
    error: str

    # nanopb ForwardResponse.error field has max_size:128
    MAX_ERROR_LENGTH = 120

    def __post_init__(self) -> None:
        if len(self.error) > self.MAX_ERROR_LENGTH:
            self.error = self.error[: self.MAX_ERROR_LENGTH - 3] + "..."


class FirebaseClient:
    """Async HTTP client for Firebase Cloud Functions."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
    ) -> None:
        """Initialize the Firebase client.

        Args:
            base_url: Base URL for Firebase functions
                (e.g., https://us-central1-oww-maschinenfreigabe.cloudfunctions.net/api)
            api_key: Gateway API key for authorization
            timeout: Request timeout in seconds
        """
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = httpx.Timeout(timeout)
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def forward(
        self,
        endpoint: str,
        payload: bytes,
        device_id: Optional[bytes] = None,
    ) -> ForwardResult:
        """Forward a request to Firebase.

        Args:
            endpoint: Firebase endpoint path (e.g., "/startSession")
            payload: Opaque protobuf payload bytes
            device_id: MACO device ID for X-Device-Id header

        Returns:
            ForwardResult with success status and response/error
        """
        url = f"{self._base_url}{endpoint}"
        logger.debug("Forwarding request to %s (%d bytes)", url, len(payload))

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }
        if device_id is not None:
            headers["X-Device-Id"] = device_id.hex()

        # Wrap protobuf payload in JSON envelope expected by Firebase functions
        json_body = {"data": base64.b64encode(payload).decode("ascii")}

        try:
            client = await self._get_client()
            response = await client.post(
                url,
                json=json_body,
                headers=headers,
            )

            if response.status_code == 200:
                # Unwrap JSON envelope: {"data": "<base64>"}
                body_json = json.loads(response.content)
                proto_bytes = base64.b64decode(body_json.get("data", ""))
                logger.debug(
                    "Firebase response: %d (%d bytes proto)",
                    response.status_code,
                    len(proto_bytes),
                )
                return ForwardResult(
                    success=True,
                    payload=proto_bytes,
                    http_status=response.status_code,
                    error="",
                )
            else:
                error_text = response.content.decode("utf-8", errors="replace")
                logger.warning(
                    "Firebase error: %d - %s", response.status_code, error_text
                )
                return ForwardResult(
                    success=False,
                    payload=b"",
                    http_status=response.status_code,
                    error=f"HTTP {response.status_code}: {error_text}",
                )

        except httpx.ConnectError as e:
            logger.error("Connection error to Firebase: %s", e)
            return ForwardResult(
                success=False, payload=b"", http_status=0, error=f"Connection error: {e}"
            )
        except httpx.HTTPError as e:
            logger.error("HTTP client error: %s", e)
            return ForwardResult(
                success=False, payload=b"", http_status=0, error=f"Client error: {e}"
            )
        except TimeoutError:
            logger.error("Request to Firebase timed out")
            return ForwardResult(
                success=False, payload=b"", http_status=0, error="Request timed out"
            )
        except Exception as e:
            logger.exception("Unexpected error forwarding to Firebase")
            return ForwardResult(
                success=False, payload=b"", http_status=0, error=f"Unexpected error: {e}"
            )

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> "FirebaseClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.close()
