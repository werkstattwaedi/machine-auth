# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Simple HTTP mock server for integration tests.

Provides canned responses for Firebase Cloud Function endpoints,
allowing tests to run without a real Firebase backend.

Uses stdlib http.server in a background thread (no external dependencies).
"""

import logging
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

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
        self._server: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None

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
        if self._server is None:
            raise RuntimeError("Server not started")
        return self._server.server_address[1]

    @property
    def url(self) -> str:
        """Get the base URL for this server."""
        return f"http://{self._host}:{self.port}"

    async def start(self) -> None:
        """Start the HTTP server in a background thread."""
        if self._server is not None:
            raise RuntimeError("Server already started")

        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                self._handle()

            def do_GET(self) -> None:
                self._handle()

            def do_PUT(self) -> None:
                self._handle()

            def _handle(self) -> None:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length) if content_length else b""

                _LOG.debug(
                    "Request: %s %s (%d bytes)", self.command, self.path, len(body)
                )
                owner._requests.append((self.path, body))

                response = owner._responses.get(self.path)
                if response:
                    _LOG.debug("Returning canned response for %s", self.path)
                    self.send_response(response.status)
                    self.send_header("Content-Type", response.content_type)
                    self.send_header("Content-Length", str(len(response.payload)))
                    self.end_headers()
                    self.wfile.write(response.payload)
                else:
                    _LOG.warning("No response configured for %s", self.path)
                    msg = f"No mock response for {self.path}".encode()
                    self.send_response(HTTPStatus.NOT_FOUND)
                    self.send_header("Content-Type", "text/plain")
                    self.send_header("Content-Length", str(len(msg)))
                    self.end_headers()
                    self.wfile.write(msg)

            def log_message(self, format: str, *args: object) -> None:
                # Suppress default stderr logging
                pass

        self._server = HTTPServer((self._host, self._port), Handler)
        self._thread = threading.Thread(
            target=self._server.serve_forever, daemon=True
        )
        self._thread.start()

        _LOG.info(
            "Mock HTTP server listening on %s:%d", self._host, self.port
        )

    async def stop(self) -> None:
        """Stop the HTTP server."""
        if self._server:
            self._server.shutdown()
            self._thread.join(timeout=5)
            self._server.server_close()
            self._server = None
            self._thread = None
        _LOG.info("Mock HTTP server stopped")

    async def __aenter__(self) -> "MockHttpServer":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()
