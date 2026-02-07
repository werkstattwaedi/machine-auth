# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Serial port detection for Particle devices using pyserial.

Provides functions to detect and wait for Particle devices connected via USB.
"""

import logging
import time
from dataclasses import dataclass
from typing import Optional

import serial.tools.list_ports
from serial.tools.list_ports_common import ListPortInfo

_LOG = logging.getLogger(__name__)

# Particle USB Vendor ID
PARTICLE_VID = 0x2B04

# Particle Product IDs by device type
PARTICLE_PIDS = {
    0xC006: "Photon",
    0xC008: "P1",
    0xC00A: "Electron",
    0xC00C: "Argon",
    0xC00D: "Boron",
    0xC00E: "Xenon",
    0xC00F: "Argon SoM",
    0xC010: "Boron SoM",
    0xC012: "B5 SoM",
    0xC020: "P2",
    0xC021: "Photon 2",
    0xC022: "M SoM",
}


@dataclass
class ParticlePort:
    """Represents a detected Particle device serial port."""

    port: str
    vid: int
    pid: int
    serial_number: Optional[str]
    device_type: str

    @classmethod
    def from_port_info(cls, info: ListPortInfo) -> "ParticlePort":
        """Create ParticlePort from pyserial port info."""
        device_type = PARTICLE_PIDS.get(info.pid or 0, "Unknown")
        return cls(
            port=info.device,
            vid=info.vid or 0,
            pid=info.pid or 0,
            serial_number=info.serial_number,
            device_type=device_type,
        )


def list_particle_ports() -> list[ParticlePort]:
    """List all serial ports with connected Particle devices.

    Uses pyserial to enumerate USB serial ports and filter by Particle VID.

    Returns:
        List of ParticlePort objects for detected devices.
    """
    ports = []
    for port_info in serial.tools.list_ports.comports():
        if port_info.vid == PARTICLE_VID:
            ports.append(ParticlePort.from_port_info(port_info))
            _LOG.debug(
                "Found Particle device: %s (%s) at %s",
                ports[-1].device_type,
                ports[-1].serial_number,
                ports[-1].port,
            )
    return ports


def find_particle_port(serial_number: Optional[str] = None) -> Optional[str]:
    """Find a Particle device serial port.

    Args:
        serial_number: Optional device serial number to match.

    Returns:
        Serial port path (e.g., "/dev/ttyACM0") or None if not found.
    """
    ports = list_particle_ports()

    if not ports:
        return None

    if serial_number:
        for port in ports:
            if port.serial_number == serial_number:
                return port.port
        return None

    # Return first found device
    return ports[0].port


def wait_for_serial_port(
    timeout: float = 15.0,
    poll_interval: float = 0.5,
    serial_number: Optional[str] = None,
) -> Optional[str]:
    """Wait for a Particle device to appear on USB.

    Args:
        timeout: Maximum time to wait in seconds.
        poll_interval: Time between port scans in seconds.
        serial_number: Optional device serial number to wait for.

    Returns:
        Serial port path if found, None if timeout.
    """
    deadline = time.time() + timeout
    last_log_time = 0.0

    _LOG.info("Waiting for Particle device (timeout: %.0fs)...", timeout)

    while time.time() < deadline:
        port = find_particle_port(serial_number)
        if port:
            _LOG.info("Device found at %s", port)
            return port

        # Log progress once per second
        now = time.time()
        if now - last_log_time >= 1.0:
            remaining = deadline - now
            _LOG.debug("Waiting for device... (%.0fs remaining)", remaining)
            last_log_time = now

        time.sleep(poll_interval)

    _LOG.warning("Device did not appear within %.0fs", timeout)
    return None


def wait_for_port_disappear(
    port: str,
    timeout: float = 10.0,
    poll_interval: float = 0.2,
) -> bool:
    """Wait for a specific port to disappear (device reset/disconnect).

    Args:
        port: Serial port path to watch.
        timeout: Maximum time to wait in seconds.
        poll_interval: Time between checks in seconds.

    Returns:
        True if port disappeared, False if timeout.
    """
    deadline = time.time() + timeout

    while time.time() < deadline:
        current_ports = [p.port for p in list_particle_ports()]
        if port not in current_ports:
            _LOG.debug("Port %s disappeared", port)
            return True
        time.sleep(poll_interval)

    return False


def wait_for_port_reappear(
    timeout: float = 30.0,
    poll_interval: float = 0.5,
    serial_number: Optional[str] = None,
) -> Optional[str]:
    """Wait for a device to reappear after reset.

    This is useful after triggering a device reset - the port may change.

    Args:
        timeout: Maximum time to wait in seconds.
        poll_interval: Time between port scans in seconds.
        serial_number: Optional device serial number to wait for.

    Returns:
        New serial port path if found, None if timeout.
    """
    return wait_for_serial_port(timeout, poll_interval, serial_number)
