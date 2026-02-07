# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Particle device representation for USB operations.

Provides a ParticleDevice class that represents a connected Particle device
and delegates USB operations to particle-cli.
"""

import logging
import time
from typing import Optional

from ..cli.wrapper import ParticleCli, ParticleCliError
from .serial_port import (
    find_particle_port,
    list_particle_ports,
    wait_for_port_disappear,
    wait_for_serial_port,
)

_LOG = logging.getLogger(__name__)


class ParticleDevice:
    """Represents a Particle device connected via USB.

    Provides methods for device operations like flashing, resetting,
    and checking cloud status.

    Usage:
        # Find first connected device
        device = ParticleDevice.find()

        # Flash firmware
        device.flash("firmware.bin")

        # Check cloud status
        if device.is_cloud_connected():
            print("Device is connected to cloud")

        # Reset device
        device.reset()
    """

    def __init__(
        self,
        name_or_id: Optional[str] = None,
        port: Optional[str] = None,
        cli: Optional[ParticleCli] = None,
    ):
        """Initialize ParticleDevice.

        Args:
            name_or_id: Device name or ID for cloud operations.
            port: Serial port path (e.g., "/dev/ttyACM0").
            cli: ParticleCli instance (creates one if not provided).
        """
        self._name_or_id = name_or_id
        self._port = port
        self._cli = cli or ParticleCli()

    @classmethod
    def find(
        cls,
        timeout: float = 0,
        cli: Optional[ParticleCli] = None,
    ) -> Optional["ParticleDevice"]:
        """Find the first connected Particle device.

        Args:
            timeout: If > 0, wait up to this many seconds for a device.
            cli: ParticleCli instance to use.

        Returns:
            ParticleDevice if found, None otherwise.
        """
        if timeout > 0:
            port = wait_for_serial_port(timeout=timeout)
        else:
            port = find_particle_port()

        if port:
            return cls(port=port, cli=cli)
        return None

    @classmethod
    def find_by_serial(
        cls,
        serial_number: str,
        timeout: float = 0,
        cli: Optional[ParticleCli] = None,
    ) -> Optional["ParticleDevice"]:
        """Find a device by USB serial number.

        Args:
            serial_number: USB device serial number.
            timeout: If > 0, wait up to this many seconds.
            cli: ParticleCli instance to use.

        Returns:
            ParticleDevice if found, None otherwise.
        """
        if timeout > 0:
            port = wait_for_serial_port(timeout=timeout, serial_number=serial_number)
        else:
            for particle_port in list_particle_ports():
                if particle_port.serial_number == serial_number:
                    port = particle_port.port
                    break
            else:
                port = None

        if port:
            return cls(port=port, cli=cli)
        return None

    @property
    def port(self) -> Optional[str]:
        """Serial port path."""
        return self._port

    @property
    def name_or_id(self) -> Optional[str]:
        """Device name or ID."""
        return self._name_or_id

    def flash(
        self,
        firmware_path: str,
        timeout: float = 120.0,
    ) -> None:
        """Flash firmware to the device via USB.

        Args:
            firmware_path: Path to firmware binary (.bin).
            timeout: Flash operation timeout in seconds.

        Raises:
            ParticleCliError: If flash fails.
        """
        _LOG.info("Flashing %s to device", firmware_path)
        self._cli.flash_local(firmware_path, timeout=timeout)
        _LOG.info("Flash complete")

    def reset(self, timeout: float = 30.0) -> None:
        """Reset the device via USB.

        Args:
            timeout: Reset operation timeout in seconds.

        Raises:
            ParticleCliError: If reset fails.
        """
        _LOG.info("Resetting device")
        self._cli.usb_reset(self._name_or_id)

        # Wait for device to disappear and reappear
        if self._port:
            _LOG.debug("Waiting for port to disappear...")
            wait_for_port_disappear(self._port, timeout=10.0)

            _LOG.debug("Waiting for device to reappear...")
            new_port = wait_for_serial_port(timeout=timeout)
            if new_port:
                self._port = new_port
                _LOG.info("Device reset complete, now at %s", new_port)
            else:
                _LOG.warning("Device did not reappear after reset")

    def enter_dfu_mode(self) -> None:
        """Put the device into DFU mode.

        Raises:
            ParticleCliError: If command fails.
        """
        _LOG.info("Entering DFU mode")
        self._cli.usb_dfu(self._name_or_id)

    def get_cloud_status(self, timeout: float = 10.0) -> str:
        """Get the cloud connection status.

        Args:
            timeout: Command timeout in seconds.

        Returns:
            Status string: "connected", "connecting", "disconnected", etc.

        Raises:
            ParticleCliError: If command fails.
        """
        if not self._name_or_id:
            # Use first device if no name specified
            return self._cli.usb_cloud_status("", timeout=timeout)
        return self._cli.usb_cloud_status(self._name_or_id, timeout=timeout)

    def is_cloud_connected(self, timeout: float = 10.0) -> bool:
        """Check if device is connected to the cloud.

        Args:
            timeout: Command timeout in seconds.

        Returns:
            True if connected, False otherwise.
        """
        try:
            status = self.get_cloud_status(timeout=timeout)
            return status == "connected"
        except ParticleCliError:
            return False

    def wait_for_cloud_connected(
        self,
        timeout: float = 60.0,
        poll_interval: float = 2.0,
    ) -> bool:
        """Wait for the device to connect to the cloud.

        Args:
            timeout: Maximum time to wait in seconds.
            poll_interval: Time between status checks in seconds.

        Returns:
            True if connected within timeout, False otherwise.
        """
        deadline = time.time() + timeout
        _LOG.info("Waiting for cloud connection (timeout: %.0fs)...", timeout)

        while time.time() < deadline:
            try:
                if self.is_cloud_connected():
                    _LOG.info("Device connected to cloud")
                    return True
            except ParticleCliError as e:
                _LOG.debug("Cloud status check failed: %s", e)

            time.sleep(poll_interval)

        _LOG.warning("Device did not connect to cloud within %.0fs", timeout)
        return False

    def call_function(
        self,
        function_name: str,
        argument: str = "",
        timeout: float = 30.0,
    ) -> int:
        """Call a cloud function on the device.

        Requires device name or ID to be set.

        Args:
            function_name: Name of the function.
            argument: String argument to pass.
            timeout: Command timeout in seconds.

        Returns:
            Integer return value from the function.

        Raises:
            ValueError: If device name/ID not set.
            ParticleCliError: If call fails.
        """
        if not self._name_or_id:
            raise ValueError("Device name or ID required for cloud operations")
        return self._cli.call_function(
            self._name_or_id, function_name, argument, timeout
        )

    def get_variable(
        self,
        variable_name: str,
        timeout: float = 30.0,
    ) -> str:
        """Get a cloud variable from the device.

        Requires device name or ID to be set.

        Args:
            variable_name: Name of the variable.
            timeout: Command timeout in seconds.

        Returns:
            String value of the variable.

        Raises:
            ValueError: If device name/ID not set.
            ParticleCliError: If get fails.
        """
        if not self._name_or_id:
            raise ValueError("Device name or ID required for cloud operations")
        return self._cli.get_variable(self._name_or_id, variable_name, timeout)
