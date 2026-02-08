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

import logging
from dataclasses import dataclass
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)


@dataclass
class ForwardResult:
    """Result of a Firebase forward request."""

    success: bool
    payload: bytes
    http_status: int
    error: str


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
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create the HTTP session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=self._timeout)
        return self._session

    async def forward(
        self,
        endpoint: str,
        payload: bytes,
        device_id: Optional[int] = None,
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
            "Content-Type": "application/x-protobuf",
            "Accept": "application/x-protobuf",
            "Authorization": f"Bearer {self._api_key}",
        }
        if device_id is not None:
            headers["X-Device-Id"] = f"{device_id:016X}"

        try:
            session = await self._get_session()
            async with session.post(
                url,
                data=payload,
                headers=headers,
            ) as response:
                response_body = await response.read()

                if response.status == 200:
                    logger.debug(
                        "Firebase response: %d (%d bytes)",
                        response.status,
                        len(response_body),
                    )
                    return ForwardResult(
                        success=True,
                        payload=response_body,
                        http_status=response.status,
                        error="",
                    )
                else:
                    error_text = response_body.decode("utf-8", errors="replace")
                    logger.warning(
                        "Firebase error: %d - %s", response.status, error_text
                    )
                    return ForwardResult(
                        success=False,
                        payload=b"",
                        http_status=response.status,
                        error=f"HTTP {response.status}: {error_text}",
                    )

        except aiohttp.ClientConnectionError as e:
            logger.error("Connection error to Firebase: %s", e)
            return ForwardResult(
                success=False, payload=b"", http_status=0, error=f"Connection error: {e}"
            )
        except aiohttp.ClientError as e:
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
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> "FirebaseClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit."""
        await self.close()
