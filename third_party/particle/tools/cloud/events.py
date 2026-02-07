# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Particle Cloud event subscription via Server-Sent Events (SSE).

Provides a context manager for subscribing to Particle Cloud events
with background thread processing.
"""

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from queue import Empty, Queue
from typing import Iterator, Optional

import requests

_LOG = logging.getLogger(__name__)

# Particle Cloud SSE endpoint
PARTICLE_EVENTS_URL = "https://api.particle.io/v1/events"


@dataclass
class CloudEvent:
    """Represents a received cloud event."""

    name: str
    data: str
    published_at: Optional[str] = None
    device_id: Optional[str] = None
    ttl: Optional[int] = None

    def __str__(self) -> str:
        return f"CloudEvent({self.name}={self.data!r})"


class EventSubscription:
    """Context manager for subscribing to Particle Cloud events via SSE.

    Usage:
        with EventSubscription("test/") as sub:
            # Do something that triggers an event
            event = sub.wait_for_event(timeout=10)
            if event:
                print(f"Got event: {event.name} = {event.data}")

    The subscription uses HTTP SSE (Server-Sent Events) for real-time
    event delivery and processes events in a background thread.
    """

    def __init__(
        self,
        prefix: str,
        device: Optional[str] = None,
        access_token: Optional[str] = None,
    ):
        """Initialize subscription.

        Args:
            prefix: Event name prefix to subscribe to.
            device: Optional device name/ID to filter events.
            access_token: API access token. If None, reads from
                PARTICLE_ACCESS_TOKEN environment variable.
        """
        self._prefix = prefix
        self._device = device
        self._access_token = access_token or os.environ.get("PARTICLE_ACCESS_TOKEN")

        if not self._access_token:
            raise ValueError(
                "Access token required. Set PARTICLE_ACCESS_TOKEN environment "
                "variable or pass access_token parameter."
            )

        self._events: Queue[CloudEvent] = Queue()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._response: Optional[requests.Response] = None

    def __enter__(self) -> "EventSubscription":
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.stop()

    def start(self) -> None:
        """Start the event subscription."""
        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(target=self._read_events, daemon=True)
        self._thread.start()

        # Give subscription time to establish
        time.sleep(1.0)
        _LOG.info("Event subscription started for prefix: %s", self._prefix)

    def stop(self) -> None:
        """Stop the event subscription."""
        self._running = False

        if self._response:
            try:
                self._response.close()
            except Exception:
                pass
            self._response = None

        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None

        _LOG.info("Event subscription stopped")

    def _build_url(self) -> str:
        """Build the SSE endpoint URL."""
        if self._device:
            return f"https://api.particle.io/v1/devices/{self._device}/events/{self._prefix}"
        return f"{PARTICLE_EVENTS_URL}/{self._prefix}"

    def _read_events(self) -> None:
        """Background thread that reads events via SSE."""
        url = self._build_url()
        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "text/event-stream",
        }

        _LOG.debug("Connecting to SSE endpoint: %s", url)

        try:
            self._response = requests.get(
                url,
                headers=headers,
                stream=True,
                timeout=(10, None),  # Connect timeout, no read timeout
            )
            self._response.raise_for_status()

            event_name = ""
            event_data = ""

            for line in self._response.iter_lines(decode_unicode=True):
                if not self._running:
                    break

                if line is None:
                    continue

                line = line.strip()

                # SSE format: event: <name>\ndata: <json>
                if line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    event_data = line[5:].strip()
                elif not line and event_data:
                    # Empty line = end of event
                    self._process_event(event_name, event_data)
                    event_name = ""
                    event_data = ""

        except requests.exceptions.RequestException as e:
            if self._running:
                _LOG.error("SSE connection error: %s", e)
        finally:
            self._running = False

    def _process_event(self, event_name: str, event_data: str) -> None:
        """Process a received SSE event."""
        try:
            data = json.loads(event_data)
            event = CloudEvent(
                name=data.get("name", event_name),
                data=data.get("data", ""),
                published_at=data.get("published_at"),
                device_id=data.get("coreid"),
                ttl=data.get("ttl"),
            )
            _LOG.debug("Received event: %s", event)
            self._events.put(event)
        except json.JSONDecodeError as e:
            _LOG.warning("Failed to parse event data: %s - %s", event_data, e)

    def wait_for_event(
        self,
        timeout: float = 10.0,
        name_filter: Optional[str] = None,
    ) -> Optional[CloudEvent]:
        """Wait for an event to arrive.

        Args:
            timeout: Maximum time to wait in seconds.
            name_filter: Optional exact event name to filter for.

        Returns:
            CloudEvent if received, None if timeout.
        """
        deadline = time.time() + timeout

        while time.time() < deadline:
            remaining = deadline - time.time()
            if remaining <= 0:
                break

            try:
                event = self._events.get(timeout=min(remaining, 1.0))
                if name_filter is None or event.name == name_filter:
                    return event
                # Skip events that don't match filter
            except Empty:
                continue

        return None

    def get_events(self) -> list[CloudEvent]:
        """Get all currently queued events.

        Returns:
            List of all events in the queue (empties the queue).
        """
        events = []
        while True:
            try:
                events.append(self._events.get_nowait())
            except Empty:
                break
        return events

    def iter_events(
        self,
        timeout: float = 1.0,
    ) -> Iterator[CloudEvent]:
        """Iterate over events as they arrive.

        Args:
            timeout: Timeout for each get attempt in seconds.

        Yields:
            CloudEvent objects as they arrive.
        """
        while self._running:
            try:
                yield self._events.get(timeout=timeout)
            except Empty:
                continue
