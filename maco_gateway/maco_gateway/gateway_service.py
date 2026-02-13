# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""GatewayService implementation for pw_rpc.

Implements the GatewayService RPC handlers:
- Forward: Proxy requests to Firebase Cloud Functions
- PersistLog: Store logs locally for offline operation
- Ping: Connection health check
"""

import logging
import time
from pathlib import Path
from typing import Optional

from .firebase_client import FirebaseClient

logger = logging.getLogger(__name__)


class GatewayServiceImpl:
    """Implementation of GatewayService RPC handlers.

    This class provides the service implementation. It will be connected to
    pw_rpc's service framework which handles the proto serialization.
    """

    def __init__(
        self,
        firebase_client: FirebaseClient,
        log_dir: Optional[Path] = None,
    ) -> None:
        """Initialize the gateway service.

        Args:
            firebase_client: HTTP client for Firebase requests
            log_dir: Directory for persisted logs (None to disable)
        """
        self._firebase = firebase_client
        self._log_dir = log_dir
        self._pending_logs: list = []

        if log_dir:
            log_dir.mkdir(parents=True, exist_ok=True)

    async def forward(
        self,
        endpoint: str,
        payload: bytes,
        request_id: int,
        device_id: Optional[bytes] = None,
    ) -> dict:
        """Handle Forward RPC.

        Args:
            endpoint: Firebase endpoint path
            payload: Request payload bytes
            request_id: Request ID for correlation
            device_id: MACO device ID (from ASCON-authenticated connection)

        Returns:
            Dict with response fields matching ForwardResponse
        """
        logger.info(
            "Forward request: endpoint=%s, request_id=%d, payload_size=%d, device=%s",
            endpoint,
            request_id,
            len(payload),
            device_id.hex() if device_id else "unknown",
        )

        result = await self._firebase.forward(endpoint, payload, device_id)

        return {
            "success": result.success,
            "payload": result.payload,
            "http_status": result.http_status,
            "error": result.error,
            "request_id": request_id,
        }

    def persist_log(
        self, timestamp_ms: int, level: int, module: str, message: str, data: str
    ) -> dict:
        """Handle PersistLog RPC.

        Args:
            timestamp_ms: Log timestamp in milliseconds
            level: Log level (0=unspecified, 1=debug, 2=info, 3=warn, 4=error)
            module: Module name
            message: Log message
            data: Optional JSON data

        Returns:
            Dict with response fields matching LogResponse
        """
        log_entry = {
            "timestamp_ms": timestamp_ms,
            "level": level,
            "module": module,
            "message": message,
            "data": data,
        }

        level_names = {0: "?", 1: "D", 2: "I", 3: "W", 4: "E"}
        level_name = level_names.get(level, "?")
        logger.info(
            "[%s] %s: %s%s",
            level_name,
            module,
            message,
            f" ({data})" if data else "",
        )

        # Store in memory for now
        self._pending_logs.append(log_entry)

        # TODO: Write to file if log_dir is set

        return {
            "success": True,
            "pending_count": len(self._pending_logs),
        }

    def ping(self, client_timestamp_ms: int) -> dict:
        """Handle Ping RPC.

        Args:
            client_timestamp_ms: Client timestamp in milliseconds

        Returns:
            Dict with response fields matching PingResponse
        """
        gateway_timestamp_ms = int(time.time() * 1000)

        logger.debug(
            "Ping: client_ts=%d, gateway_ts=%d, delta=%d ms",
            client_timestamp_ms,
            gateway_timestamp_ms,
            gateway_timestamp_ms - client_timestamp_ms,
        )

        return {
            "gateway_timestamp_ms": gateway_timestamp_ms,
            "client_timestamp_ms": client_timestamp_ms,
        }

    @property
    def pending_log_count(self) -> int:
        """Get the number of pending logs."""
        return len(self._pending_logs)

    def clear_pending_logs(self) -> None:
        """Clear pending logs after successful upload."""
        self._pending_logs.clear()
