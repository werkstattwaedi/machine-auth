# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""P2 device fixture for integration tests.

Handles flashing firmware and establishing RPC communication with
a P2 device connected via USB.
"""

import asyncio
import logging
import os
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Iterable, Optional

import serial
from pw_hdlc import rpc as hdlc_rpc
from pw_log.log_decoder import timestamp_parser_ms_since_boot
from pw_log.proto import log_pb2
from pw_stream import stream_readers
from pw_system.device import Device as PwSystemDevice, DEFAULT_DEVICE_LOGGER
from pw_tokenizer import detokenize

from tools.usb.flash import ParticleFlasher, FlashError
from tools.usb.serial_port import wait_for_serial_port

_LOG = logging.getLogger(__name__)


def _resolve_runfiles_path(path: Path) -> Path:
    """Resolve a path relative to bazel runfiles if needed.

    Args:
        path: Path that may be relative to runfiles root.

    Returns:
        Resolved absolute path.
    """
    if path.is_absolute():
        return path

    # Check RUNFILES_DIR environment variable (set by bazel)
    runfiles_dir = os.environ.get("RUNFILES_DIR")
    if runfiles_dir:
        # Bazel runfiles structure: $RUNFILES_DIR/_main/<path>
        resolved = Path(runfiles_dir) / "_main" / path
        if resolved.exists():
            return resolved

    # Fall back to checking relative to CWD
    if path.exists():
        return path.resolve()

    return path

# Logger used by PwSystemDevice for device log messages
_DEVICE_LOG = DEFAULT_DEVICE_LOGGER


class _DeviceLogFormatter(logging.Formatter):
    """Custom formatter for device logs that cleans up the pw_system format.

    Input format from pw_system:
      [RpcDevice] module 00:00:04.222 Message file.cc:123

    Output format:
      [P2] 00:00:04.222 module | Message
                               | file.cc:123
    """

    # ANSI color codes
    CYAN = "\033[36m"
    YELLOW = "\033[33m"
    RED = "\033[31m"
    BOLD_RED = "\033[1;31m"
    DIM = "\033[2m"
    RESET = "\033[0m"

    # Level colors
    LEVEL_COLORS = {
        logging.DEBUG: DIM,
        logging.INFO: "",
        logging.WARNING: YELLOW,
        logging.ERROR: RED,
        logging.CRITICAL: BOLD_RED,
    }

    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        level_color = self.LEVEL_COLORS.get(record.levelno, "")

        # Parse the pw_system log format: [RpcDevice] module timestamp message file:line
        # Example: [RpcDevice]  00:00:04.222 Message file.cc:123
        # Example: [RpcDevice] pw_system 00:00:04.224 Message file.cc:114

        # Remove [RpcDevice] prefix if present
        if msg.startswith("[RpcDevice]"):
            msg = msg[11:].lstrip()

        # Try to extract timestamp (format: HH:MM:SS.mmm)
        match = re.match(r'^(\S*)\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s+(.+)$', msg)
        if match:
            module = match.group(1)
            timestamp = match.group(2)
            rest = match.group(3)

            # Check if rest ends with file:line pattern
            file_match = re.search(r'\s+([\w/._+-]+:\d+)$', rest)
            if file_match:
                message = rest[:file_match.start()]
                source = file_match.group(1)
                # Shorten external paths
                source = source.replace("external/particle_bazel+/", "")
                source = source.replace("external/pigweed+/", "pw/")
            else:
                message = rest
                source = None

            # Format: [P2] timestamp module | message
            prefix = f"{self.CYAN}[P2]{self.RESET}"
            ts = f"{self.DIM}{timestamp}{self.RESET}"
            mod = f"{self.DIM}{module:12}{self.RESET}" if module else " " * 12

            if source:
                return f"{prefix} {ts} {mod} {level_color}{message}{self.RESET}\n{' ' * 32}{self.DIM}{source}{self.RESET}"
            else:
                return f"{prefix} {ts} {mod} {level_color}{message}{self.RESET}"

        # Fallback: just prefix with [P2]
        return f"{self.CYAN}[P2]{self.RESET} {level_color}{msg}{self.RESET}"



class P2DeviceFixture:
    """Fixture for testing on real P2 hardware.

    This fixture:
    1. Flashes test firmware to the P2 device
    2. Waits for the device to reboot
    3. Opens USB serial connection
    4. Initializes pw_rpc client over HDLC (using pw_system.device.Device)

    The device is available after start() completes.

    Example:
        fixture = P2DeviceFixture(
            firmware_bin=Path("test_firmware.bin"),
            firmware_elf=Path("test_firmware"),  # For log detokenization
            proto_modules=[test_pb2],
        )
        await fixture.start()
        try:
            result = fixture.device.rpcs.test.TestControl.DoSomething()
            print(result)
        finally:
            await fixture.stop()
    """

    def __init__(
        self,
        firmware_bin: Path,
        proto_paths: Iterable[Path | ModuleType],
        firmware_elf: Optional[Path] = None,
        channel_id: int = hdlc_rpc.DEFAULT_CHANNEL_ID,
        flash_timeout: float = 120.0,
        device_timeout: float = 30.0,
        serial_number: Optional[str] = None,
        baudrate: int = 115200,
        rpc_timeout: float = 5.0,
        show_device_logs: bool = True,
    ) -> None:
        """Initialize the P2 device fixture.

        Args:
            firmware_bin: Path to firmware binary (.bin) to flash.
            proto_paths: Proto modules (compiled _pb2 modules).
            firmware_elf: Path to firmware ELF for log detokenization.
                         If not provided, logs will show raw tokens.
            channel_id: pw_rpc channel ID.
            flash_timeout: Timeout for flashing in seconds.
            device_timeout: Timeout for device to appear after flash in seconds.
            serial_number: Optional device serial number for selection.
            baudrate: Serial baud rate.
            rpc_timeout: Default RPC call timeout in seconds.
            show_device_logs: If True, display detokenized device logs to stderr.
                             Useful for debugging crashes and firmware issues.
        """
        self._firmware_bin = Path(firmware_bin)
        self._firmware_elf = Path(firmware_elf) if firmware_elf else None
        self._proto_paths = list(proto_paths)
        self._channel_id = channel_id
        self._flash_timeout = flash_timeout
        self._device_timeout = device_timeout
        self._serial_number = serial_number
        self._baudrate = baudrate
        self._rpc_timeout = rpc_timeout
        self._show_device_logs = show_device_logs

        self._device: Optional[PwSystemDevice] = None
        self._serial: Optional[serial.Serial] = None
        self._reader: Optional[stream_readers.SelectableReader] = None
        self._port: Optional[str] = None
        self._detokenizer: Optional[detokenize.Detokenizer] = None
        self._device_log_handler: Optional[logging.Handler] = None

    async def start(self) -> None:
        """Flash firmware and start RPC communication.

        Raises:
            FlashError: If flashing fails.
            RuntimeError: If device does not appear or RPC fails.
        """
        if self._device is not None:
            raise RuntimeError("Device fixture already started")

        # Configure device log handler if enabled
        if self._show_device_logs:
            self._device_log_handler = logging.StreamHandler(sys.stderr)
            self._device_log_handler.setLevel(logging.DEBUG)
            self._device_log_handler.setFormatter(_DeviceLogFormatter())
            _DEVICE_LOG.addHandler(self._device_log_handler)
            # Prevent propagation to root logger to avoid duplicate output
            _DEVICE_LOG.propagate = False
            _LOG.info("Device log output enabled")

        # Resolve firmware paths (may be relative to bazel runfiles)
        firmware_bin = _resolve_runfiles_path(self._firmware_bin)
        _LOG.info("Resolved firmware binary: %s", firmware_bin)
        if not firmware_bin.exists():
            raise RuntimeError(f"Firmware binary not found: {firmware_bin}")

        # Flash firmware (synchronous, run in thread pool)
        _LOG.info("Flashing firmware: %s", firmware_bin)
        await asyncio.to_thread(self._flash_firmware, firmware_bin)

        # Wait for device to reboot and appear
        _LOG.info("Waiting for device to appear...")
        self._port = await asyncio.to_thread(
            wait_for_serial_port,
            timeout=self._device_timeout,
            serial_number=self._serial_number,
        )
        if not self._port:
            raise RuntimeError(
                f"Device did not appear within {self._device_timeout}s"
            )
        _LOG.info("Device found at %s", self._port)

        # Set up detokenizer if ELF provided
        if self._firmware_elf:
            firmware_elf = _resolve_runfiles_path(self._firmware_elf)
            _LOG.info("Resolved firmware ELF: %s", firmware_elf)
            if firmware_elf.exists():
                _LOG.info("Loading token database from %s", firmware_elf)
                # Use #.* domain pattern to match all token domains
                self._detokenizer = detokenize.AutoUpdatingDetokenizer(
                    str(firmware_elf) + "#.*"
                )
                self._detokenizer.show_errors = True
            else:
                _LOG.warning("Firmware ELF not found: %s - logs will show raw tokens", firmware_elf)
                self._detokenizer = None
        else:
            _LOG.warning("No firmware ELF provided - logs will show raw tokens")
            self._detokenizer = None

        # Initialize RPC using pw_system.device.Device (same as console)
        _LOG.info("Initializing RPC client...")
        self._serial = serial.Serial(
            self._port,
            baudrate=self._baudrate,
            timeout=0.1,
        )
        self._reader = stream_readers.SelectableReader(self._serial, 8192)

        # Create Device with HDLC encoding and RPC logging
        # Include log_pb2 proto to enable pw_system log streaming
        proto_library = list(self._proto_paths) + [log_pb2]
        self._device = PwSystemDevice(
            channel_id=self._channel_id,
            reader=self._reader,
            write=self._serial.write,
            proto_library=proto_library,
            detokenizer=self._detokenizer,
            timestamp_decoder=timestamp_parser_ms_since_boot,
            rpc_timeout_s=self._rpc_timeout,
            use_rpc_logging=self._show_device_logs,  # Enable RPC log streaming
            use_hdlc_encoding=True,
        )

        # Wait for pw_system to fully initialize after we open the serial port.
        # The firmware waits for USB "connected" (which happens when we open
        # the port), then needs time to register services and start pw_system.
        _LOG.info("Waiting for pw_system to initialize...")
        await asyncio.sleep(3.0)

        _LOG.info("P2 device fixture started")

    def _flash_firmware(self, firmware_path: Path) -> None:
        """Flash firmware to the device (runs in thread pool)."""
        flasher = ParticleFlasher()
        flasher.flash_local(
            str(firmware_path),
            wait_for_device=True,
            device_timeout=self._device_timeout,
            flash_timeout=self._flash_timeout,
        )

    async def stop(self) -> None:
        """Stop RPC communication and clean up."""
        if self._device:
            self._device.close()  # Stop background threads
            self._device = None

        if self._reader:
            self._reader.cancel_read()  # Cancel any pending reads
            self._reader = None

        if self._serial:
            self._serial.close()
            self._serial = None

        # Remove device log handler and restore propagation
        if self._device_log_handler:
            _DEVICE_LOG.removeHandler(self._device_log_handler)
            _DEVICE_LOG.propagate = True  # Restore default propagation
            self._device_log_handler = None

        self._port = None
        _LOG.info("P2 device fixture stopped")

    @property
    def device(self) -> PwSystemDevice:
        """Get the pw_system Device for communicating with the device.

        Raises:
            RuntimeError: If fixture is not started.
        """
        if self._device is None:
            raise RuntimeError("Device fixture not started")
        return self._device

    # Alias for backwards compatibility
    @property
    def rpc(self) -> PwSystemDevice:
        """Alias for device property."""
        return self.device

    @property
    def port(self) -> str:
        """Get the serial port path.

        Raises:
            RuntimeError: If fixture is not started.
        """
        if self._port is None:
            raise RuntimeError("Device fixture not started")
        return self._port

    async def __aenter__(self) -> "P2DeviceFixture":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()
