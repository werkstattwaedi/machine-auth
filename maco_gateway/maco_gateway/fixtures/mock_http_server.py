# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Simple HTTP mock server for integration tests.

Provides canned responses for Firebase Cloud Function endpoints,
allowing tests to run without a real Firebase backend.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from aiohttp import web

_LOG = logging.getLogger(__name__)


@dataclass
class CannedResponse:
    """A canned HTTP response.

    Attributes:
        payload: Response body bytes.
        status: HTTP status code.
        content_type: Response content type.
    """

    payload: bytes = b""
    status: int = 200
    content_type: str = "application/x-protobuf"


class MockHttpServer:
    """Simple HTTP server returning canned responses.

    Example:
        server = MockHttpServer()
        server.set_response("/api/startSession", CannedResponse(
            payload=start_session_response.SerializeToString(),
        ))

        await server.start()
        try:
            # Gateway sends requests to http://localhost:{server.port}/api/startSession
            print(f"Mock server at http://localhost:{server.port}")
        finally:
            await server.stop()
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 0) -> None:
        """Initialize the mock server.

        Args:
            host: Host to bind to.
            port: Port to bind to (0 for auto-assign).
        """
        self._host = host
        self._port = port
        self._responses: dict[str, CannedResponse] = {}
        self._requests: list[tuple[str, bytes]] = []
        self._runner: Optional[web.AppRunner] = None
        self._actual_port: Optional[int] = None

    def set_response(self, path: str, response: CannedResponse) -> None:
        """Set canned response for a path."""
        self._responses[path] = response

    def clear_responses(self) -> None:
        """Clear all canned responses."""
        self._responses.clear()

    def get_requests(self, path: Optional[str] = None) -> list[tuple[str, bytes]]:
        """Get logged requests, optionally filtered by path."""
        if path:
            return [(p, body) for p, body in self._requests if p == path]
        return list(self._requests)

    def clear_requests(self) -> None:
        """Clear request log."""
        self._requests.clear()

    @property
    def port(self) -> int:
        """Get the actual bound port."""
        if self._actual_port is None:
            raise RuntimeError("Server not started")
        return self._actual_port

    @property
    def url(self) -> str:
        """Get the base URL for this server."""
        return f"http://{self._host}:{self.port}"

    async def start(self) -> None:
        """Start the HTTP server."""
        if self._runner is not None:
            raise RuntimeError("Server already started")

        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self._handle_request)

        self._runner = web.AppRunner(app)
        await self._runner.setup()

        site = web.TCPSite(self._runner, self._host, self._port)
        await site.start()

        # Get actual port
        self._actual_port = site._server.sockets[0].getsockname()[1]
        _LOG.info("Mock HTTP server listening on %s:%d", self._host, self._actual_port)

    async def stop(self) -> None:
        """Stop the HTTP server."""
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
            self._actual_port = None
        _LOG.info("Mock HTTP server stopped")

    async def _handle_request(self, request: web.Request) -> web.Response:
        """Handle incoming HTTP request."""
        path = "/" + request.match_info["path"]
        body = await request.read()

        _LOG.debug("Request: %s %s (%d bytes)", request.method, path, len(body))
        self._requests.append((path, body))

        # Find matching response
        response = self._responses.get(path)
        if response:
            _LOG.debug("Returning canned response for %s", path)
            return web.Response(
                body=response.payload,
                status=response.status,
                content_type=response.content_type,
            )

        # Default: 404
        _LOG.warning("No response configured for %s", path)
        return web.Response(status=404, text=f"No mock response for {path}")

    async def __aenter__(self) -> "MockHttpServer":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()
