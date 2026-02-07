# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Particle firmware flashing utilities.

Provides a ParticleFlasher class for reliable firmware flashing
with device detection and retry logic.
"""

import logging
import os
from pathlib import Path
from typing import Optional

from ..cli.wrapper import ParticleCli, ParticleCliError
from .device import ParticleDevice
from .serial_port import wait_for_serial_port

_LOG = logging.getLogger(__name__)


class FlashError(Exception):
    """Raised when firmware flashing fails."""

    pass


class ParticleFlasher:
    """Handles firmware flashing to Particle devices.

    Provides reliable flashing with device detection, retries,
    and post-flash verification.

    Usage:
        flasher = ParticleFlasher()

        # Flash and wait for device to reconnect
        flasher.flash_local("firmware.bin")

        # Flash with cloud connection wait
        flasher.flash_and_verify("firmware.bin", wait_for_cloud=True)
    """

    def __init__(
        self,
        cli: Optional[ParticleCli] = None,
        device_name: Optional[str] = None,
    ):
        """Initialize the flasher.

        Args:
            cli: ParticleCli instance (creates one if not provided).
            device_name: Optional device name for cloud operations.
        """
        self._cli = cli or ParticleCli()
        self._device_name = device_name

    def flash_local(
        self,
        firmware_path: str,
        wait_for_device: bool = True,
        device_timeout: float = 20.0,
        flash_timeout: float = 120.0,
    ) -> ParticleDevice:
        """Flash firmware to a locally connected device via USB.

        Args:
            firmware_path: Path to firmware binary (.bin).
            wait_for_device: If True, wait for device before flashing.
            device_timeout: Time to wait for device in seconds.
            flash_timeout: Flash operation timeout in seconds.

        Returns:
            ParticleDevice representing the flashed device.

        Raises:
            FlashError: If flashing fails.
        """
        firmware = Path(firmware_path)
        if not firmware.exists():
            raise FlashError(f"Firmware file not found: {firmware_path}")

        # Wait for device to be present
        if wait_for_device:
            _LOG.info("Waiting for device...")
            port = wait_for_serial_port(timeout=device_timeout)
            if not port:
                raise FlashError(
                    f"No Particle device found within {device_timeout}s"
                )
            _LOG.info("Device found at %s", port)
        else:
            port = None

        # Flash firmware
        _LOG.info("Flashing %s...", firmware.name)
        try:
            self._cli.flash_local(str(firmware), timeout=flash_timeout)
        except ParticleCliError as e:
            raise FlashError(f"Flash failed: {e}") from e

        _LOG.info("Flash complete")

        # Return device reference
        return ParticleDevice(
            name_or_id=self._device_name,
            port=port,
            cli=self._cli,
        )

    def flash_and_verify(
        self,
        firmware_path: str,
        wait_for_cloud: bool = False,
        cloud_timeout: float = 60.0,
        device_timeout: float = 20.0,
        flash_timeout: float = 120.0,
        reconnect_timeout: float = 30.0,
    ) -> ParticleDevice:
        """Flash firmware and verify device operation.

        Args:
            firmware_path: Path to firmware binary (.bin).
            wait_for_cloud: If True, wait for cloud connection after flash.
            cloud_timeout: Time to wait for cloud connection in seconds.
            device_timeout: Time to wait for initial device in seconds.
            flash_timeout: Flash operation timeout in seconds.
            reconnect_timeout: Time to wait for device to reconnect after flash.

        Returns:
            ParticleDevice representing the flashed and verified device.

        Raises:
            FlashError: If flashing or verification fails.
        """
        # Flash the device
        device = self.flash_local(
            firmware_path,
            wait_for_device=True,
            device_timeout=device_timeout,
            flash_timeout=flash_timeout,
        )

        # Wait for device to reconnect after flash
        _LOG.info("Waiting for device to reconnect...")
        port = wait_for_serial_port(timeout=reconnect_timeout)
        if not port:
            raise FlashError(
                f"Device did not reconnect within {reconnect_timeout}s"
            )

        device = ParticleDevice(
            name_or_id=self._device_name,
            port=port,
            cli=self._cli,
        )
        _LOG.info("Device reconnected at %s", port)

        # Optionally wait for cloud connection
        if wait_for_cloud:
            _LOG.info("Waiting for cloud connection...")
            if not device.wait_for_cloud_connected(timeout=cloud_timeout):
                raise FlashError(
                    f"Device did not connect to cloud within {cloud_timeout}s"
                )

        return device

    def flash_with_retry(
        self,
        firmware_path: str,
        max_retries: int = 3,
        retry_delay: float = 5.0,
        **kwargs,
    ) -> ParticleDevice:
        """Flash firmware with retry on failure.

        Args:
            firmware_path: Path to firmware binary (.bin).
            max_retries: Maximum retry attempts.
            retry_delay: Delay between retries in seconds.
            **kwargs: Additional arguments passed to flash_local.

        Returns:
            ParticleDevice representing the flashed device.

        Raises:
            FlashError: If all retries fail.
        """
        import time

        last_error: Optional[Exception] = None

        for attempt in range(max_retries + 1):
            try:
                return self.flash_local(firmware_path, **kwargs)
            except (FlashError, ParticleCliError) as e:
                last_error = e
                if attempt < max_retries:
                    _LOG.warning(
                        "Flash attempt %d/%d failed: %s. Retrying in %.0fs...",
                        attempt + 1,
                        max_retries + 1,
                        str(e),
                        retry_delay,
                    )
                    time.sleep(retry_delay)

        assert last_error is not None
        raise FlashError(f"Flash failed after {max_retries + 1} attempts") from last_error
