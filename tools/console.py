# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""MACO console - wraps pw_system's console with project-specific RPC protos.

Features:
- Auto-reconnect when device disconnects/reconnects
- Project-specific RPC methods (echo, get_device_info)

Usage:
    bazel run //tools:console -- --device /dev/ttyACM0
    bazel run //tools:console -- --socket-addr default
"""

import argparse
import glob
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from types import ModuleType
from typing import Callable, Collection

import serial
import pw_cli
from pw_console import pyserial_wrapper
from pw_console import socket_client
from pw_hdlc import rpc
from pw_log.log_decoder import timestamp_parser_ms_since_boot
from pw_stream import stream_readers
from pw_tokenizer import detokenize
from pw_system.device import Device as PwSystemDevice
from pw_system.device_connection import (
    add_device_args,
    DeviceConnection,
)
import pw_system.console
from maco_pb import maco_service_pb2
from maco_pb import nfc_mock_service_pb2

# Pigweed default protos
from pw_file import file_pb2
from pw_log.proto import log_pb2
from pw_metric_proto import metric_service_pb2
from pw_rpc import echo_pb2
from pw_thread_protos import thread_snapshot_service_pb2
from pw_trace_protos import trace_service_pb2
from pw_system_protos import device_service_pb2
from pw_unit_test_proto import unit_test_pb2


_LOG = logging.getLogger(__file__)


def _get_project_root() -> Path:
    """Get project root from MACO_PROJECT_ROOT environment variable."""
    root = os.environ.get("MACO_PROJECT_ROOT")
    if root:
        return Path(root)
    # Fallback: try to find it (may not work from bazel runfiles)
    path = Path.cwd()
    while path != path.parent:
        if (path / "MODULE.bazel").exists():
            return path
        path = path.parent
    raise RuntimeError(
        "MACO_PROJECT_ROOT not set and could not find project root. "
        "Run via ./pw console instead of bazel run directly."
    )


def _run_cmd(
    cmd: list[str],
    check: bool = False,
    use_bazel_env: bool = True,
) -> subprocess.CompletedProcess:
    """Run a command with output captured to avoid corrupting the TUI.

    Args:
        cmd: Command and arguments to run.
        check: If True, raise on non-zero exit.
        use_bazel_env: If True, set BAZELISK_SKIP_WRAPPER=1.

    Returns:
        CompletedProcess with captured stdout/stderr.
    """
    project_root = _get_project_root()
    env = os.environ.copy()
    if use_bazel_env:
        env["BAZELISK_SKIP_WRAPPER"] = "1"

    _LOG.info("Running: %s", " ".join(cmd))
    result = subprocess.run(
        cmd,
        cwd=project_root,
        env=env,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        _LOG.error("Command failed (exit %d)", result.returncode)
        # Log last 20 lines of stderr
        if result.stderr:
            for line in result.stderr.strip().split("\n")[-20:]:
                _LOG.error("%s", line)
        if check:
            raise subprocess.CalledProcessError(
                result.returncode, cmd, result.stdout, result.stderr
            )
    return result


class ReconnectingSerialClient:
    """Serial client with automatic reconnection on disconnect.

    Mimics the socket_client.SocketClient interface so it can be used
    with pw_stream.stream_readers.SelectableReader.
    """

    DEFAULT_TIMEOUT = 0.1
    DEFAULT_MAX_READ_SIZE = 256

    def __init__(
        self,
        device: str,
        baudrate: int,
        on_disconnect: Callable[["ReconnectingSerialClient"], None] | None = None,
        timeout: float | None = None,
        serial_debug: bool = False,
    ):
        self._device = device
        self._baudrate = baudrate
        self._on_disconnect = on_disconnect
        self._timeout = timeout or self.DEFAULT_TIMEOUT
        self._serial_debug = serial_debug
        self._serial: serial.Serial | None = None
        self._connected = False
        self.connect()

    def connect(self) -> None:
        """Connect to the serial port."""
        self.connect_to(self._device)

    def connect_to(self, device: str) -> None:
        """Connect to a specific serial port.

        Args:
            device: Path to serial device (e.g., /dev/particle_1234)
        """
        if self._serial is not None:
            try:
                self._serial.close()
            except Exception:
                pass

        serial_impl = (
            pyserial_wrapper.SerialWithLogging
            if self._serial_debug
            else serial.Serial
        )
        self._serial = serial_impl(
            device,
            self._baudrate,
            timeout=self._timeout,
        )
        self._device = device
        self._connected = True
        _LOG.info("Connected to %s", device)

    def write(self, data: bytes) -> int | None:
        """Write data to serial port, handling disconnects."""
        if not self._connected or self._serial is None:
            raise Exception("Serial is not connected.")
        try:
            return self._serial.write(data)
        except (OSError, serial.SerialException) as e:
            _LOG.error("Write error: %s", e)
            self._handle_disconnect()
            # After reconnect, retry the write
            return self._serial.write(data) if self._serial else None

    def read(self, num_bytes: int = DEFAULT_MAX_READ_SIZE) -> bytes:
        """Read from serial port, handling disconnects."""
        if not self._connected or self._serial is None:
            raise Exception("Serial is not connected.")
        try:
            data = self._serial.read(num_bytes)
            return data if data else b""
        except (OSError, serial.SerialException) as e:
            _LOG.error("Read error: %s", e)
            self._handle_disconnect()
            # After reconnect, return empty to let caller retry
            return b""

    def _handle_disconnect(self) -> None:
        """Handle disconnection by calling the reconnect callback."""
        self._connected = False
        if self._serial:
            try:
                self._serial.close()
            except Exception:
                pass
            self._serial = None

        if self._on_disconnect:
            self._on_disconnect(self)

    def fileno(self) -> int:
        """Return file descriptor for select().

        Returns -1 when disconnected so SelectableReader can handle it.
        """
        if self._serial is None:
            return -1
        try:
            return self._serial.fileno()
        except Exception:
            return -1

    def close(self) -> None:
        """Close the serial connection."""
        if self._serial:
            self._serial.close()
            self._serial = None
        self._connected = False


def wait_for_device(device_path: str, timeout: float = 30.0) -> bool:
    """Wait for device to appear at the given path."""
    start = time.time()
    while time.time() - start < timeout:
        # Handle glob patterns like /dev/particle_*
        if '*' in device_path:
            matches = glob.glob(device_path)
            if matches:
                return True
        elif os.path.exists(device_path):
            return True
        time.sleep(0.5)
    return False


class Device(PwSystemDevice):
    """MACO-specific device with convenience methods for RPC calls."""

    def __init__(self, serial_suffix: str | None = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._serial_suffix = serial_suffix

    @property
    def serial_suffix(self) -> str | None:
        """Last 4 digits of device serial number."""
        return self._serial_suffix

    def echo(self, data: bytes) -> bytes:
        """Echo data back from the device."""
        response = self.rpcs.maco.MacoService.Echo(data=data)
        return response.response.data

    def get_device_info(self):
        """Get device information (firmware version, uptime, build target)."""
        response = self.rpcs.maco.MacoService.GetDeviceInfo()
        return response.response

    def update(self, target: str | None = None) -> int:
        """Build and flash firmware, then reconnect.

        Args:
            target: Bazel target to build/flash. Defaults to P2 workflow build.
                    If target ends with .bin, flashes that binary directly.

        Returns:
            Exit code (0 on success)
        """
        if target is None:
            # Default: build p2 workflow then flash
            _LOG.info("Building P2 firmware...")
            result = _run_cmd(["./pw", "build", "p2"])
            if result.returncode != 0:
                return result.returncode
            _LOG.info("Flashing...")
            result = _run_cmd(["./pw", "flash"])
        elif target.endswith(".bin"):
            # Direct flash of specific binary
            _LOG.info("Flashing %s...", target)
            result = _run_cmd(["bazelisk", "run", target])
        else:
            # Build specific target, then flash
            _LOG.info("Building %s...", target)
            result = _run_cmd(["bazelisk", "build", target])
            if result.returncode != 0:
                return result.returncode
            _LOG.info("Flashing...")
            result = _run_cmd(["./pw", "flash"])

        return result.returncode
        # Note: ReconnectingSerialClient handles reconnection automatically

    def reset(self) -> None:
        """Reboot the device.

        Device will disconnect and reconnect automatically.
        """
        _LOG.info("Resetting device...")
        self._run_particle_usb_command("reset")
        # ReconnectingSerialClient handles reconnection

    def dfu(self) -> None:
        """Enter DFU mode for low-level USB flashing.

        Warning: Console will disconnect. Use `./pw flash` to reflash,
        or power cycle the device to exit DFU mode.
        """
        _LOG.info("Entering DFU mode...")
        self._run_particle_usb_command("dfu")

    def safe_mode(self) -> None:
        """Boot into safe mode (Device OS only, no user application).

        Useful for recovering from crashes or updating Device OS.
        Device will reconnect in safe mode (breathing magenta LED).
        """
        _LOG.info("Entering safe mode...")
        self._run_particle_usb_command("safe-mode")

    def listening_mode(self) -> None:
        """Enter listening/setup mode for WiFi configuration.

        Device enters setup mode (blinking blue LED).
        Use Particle app or CLI to configure WiFi.
        """
        _LOG.info("Entering listening mode...")
        self._run_particle_usb_command("start-listening")

    def cloud_status(self) -> str:
        """Get cloud connection status.

        Returns:
            Status string: "connected", "connecting", "disconnected", etc.
        """
        result = _run_cmd([
            "bazelisk", "run", "@particle_bazel//tools:particle_cli",
            "--", "usb", "cloud-status",
        ])
        # Parse output like "Cloud status: connected"
        output = result.stdout.strip()
        if ":" in output:
            return output.split(":")[-1].strip().lower()
        return output.lower()

    def _run_particle_usb_command(self, command: str) -> None:
        """Run a particle usb command using bazel-provided particle-cli."""
        _run_cmd([
            "bazelisk", "run", "@particle_bazel//tools:particle_cli",
            "--", "usb", command,
        ], check=True)


def create_connection(
    device: str | None,
    baudrate: int,
    token_databases: Collection[Path],
    socket_addr: str | None = None,
    serial_debug: bool = False,
    compiled_protos: list[ModuleType] | None = None,
    rpc_logging: bool = True,
    channel_id: int = rpc.DEFAULT_CHANNEL_ID,
    hdlc_encoding: bool = True,
    serial_suffix: str | None = None,
) -> DeviceConnection:
    """Create a device connection with auto-reconnect for serial devices."""

    detokenizer = None
    if token_databases:
        token_databases_with_domains = []
        for token_database in token_databases:
            token_databases_with_domains.append(str(token_database) + "#.*")
        detokenizer = detokenize.AutoUpdatingDetokenizer(
            *token_databases_with_domains
        )
        detokenizer.show_errors = True

    protos: list[ModuleType | Path] = []
    if compiled_protos is None:
        compiled_protos = []

    compiled_protos.append(log_pb2)
    compiled_protos.append(unit_test_pb2)
    protos.extend(compiled_protos)
    protos.append(metric_service_pb2)
    protos.append(thread_snapshot_service_pb2)
    protos.append(file_pb2)
    protos.append(echo_pb2)
    protos.append(trace_service_pb2)
    protos.append(device_service_pb2)

    reader: stream_readers.SelectableReader

    if socket_addr is None:
        # Serial connection with auto-reconnect
        # If we have a serial suffix, reconnect by pattern to handle device path changes
        device_pattern = f"/dev/particle_*{serial_suffix}" if serial_suffix else device

        def disconnect_handler(serial_client: ReconnectingSerialClient) -> None:
            """Attempts to reconnect on disconnected serial."""
            _LOG.error("Serial disconnected. Waiting for device to reappear...")
            while True:
                if wait_for_device(device_pattern, timeout=1.0):
                    # Find the matching device
                    if "*" in device_pattern:
                        matches = glob.glob(device_pattern)
                        actual_device = matches[0] if matches else device
                    else:
                        actual_device = device
                    try:
                        time.sleep(0.5)  # Let device initialize
                        serial_client.connect_to(actual_device)
                        _LOG.info("Successfully reconnected to %s", actual_device)
                        break
                    except Exception as e:
                        _LOG.debug("Reconnect attempt failed: %s", e)
                time.sleep(1)

        serial_client = ReconnectingSerialClient(
            device=device,
            baudrate=baudrate,
            on_disconnect=disconnect_handler,
            serial_debug=serial_debug,
        )
        reader = stream_readers.SelectableReader(serial_client, 8192)
        write = serial_client.write
    else:
        # Socket connection (uses existing Pigweed implementation)
        socket_impl = (
            socket_client.SocketClientWithLogging
            if serial_debug
            else socket_client.SocketClient
        )

        def socket_disconnect_handler(
            socket_device: socket_client.SocketClient,
        ) -> None:
            """Attempts to reconnect on disconnected socket."""
            _LOG.error("Socket disconnected. Will retry to connect.")
            while True:
                try:
                    socket_device.connect()
                    break
                except Exception:
                    time.sleep(1)
            _LOG.info("Successfully reconnected")

        socket_device = socket_impl(
            socket_addr, on_disconnect=socket_disconnect_handler
        )
        reader = stream_readers.SelectableReader(socket_device, 8192)
        write = socket_device.write

    device_client = Device(
        serial_suffix=serial_suffix,
        channel_id=channel_id,
        reader=reader,
        write=write,
        proto_library=protos,
        detokenizer=detokenizer,
        timestamp_decoder=timestamp_parser_ms_since_boot,
        rpc_timeout_s=5,
        use_rpc_logging=rpc_logging,
        use_hdlc_encoding=hdlc_encoding,
    )

    return DeviceConnection(device_client, reader, write)


def main() -> int:
    pw_cli.log.install(level=logging.DEBUG)

    # First extract --device-serial-suffix (our custom arg)
    serial_suffix = None
    filtered_argv = [sys.argv[0]]
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "--device-serial-suffix" and i + 1 < len(sys.argv):
            serial_suffix = sys.argv[i + 1]
            i += 2
        elif arg.startswith("--device-serial-suffix="):
            serial_suffix = arg.split("=", 1)[1]
            i += 1
        else:
            filtered_argv.append(arg)
            i += 1

    # Parse remaining args with standard device args parser
    parser = argparse.ArgumentParser(
        prog="maco-console",
        description=__doc__,
    )
    parser = add_device_args(parser)
    args, remaining_args = parser.parse_known_args(filtered_argv[1:])

    is_serial = args.device is not None

    # For serial devices, wait for device to be available
    if is_serial and not os.path.exists(args.device):
        print(f"⏳ Waiting for device {args.device}...")
        if not wait_for_device(args.device):
            print(f"❌ Device {args.device} not found")
            return 1
        print(f"✓ Device {args.device} found")
        # Small delay to let device initialize
        time.sleep(0.5)

    try:
        if serial_suffix:
            print(f"🔌 Connected to {args.device} (serial: ...{serial_suffix})")

        device_connection = create_connection(
            device=args.device,
            baudrate=args.baudrate,
            token_databases=args.token_databases or [],
            socket_addr=args.socket_addr,
            serial_debug=args.serial_debug,
            compiled_protos=[maco_service_pb2, nfc_mock_service_pb2],
            rpc_logging=args.rpc_logging,
            hdlc_encoding=args.hdlc_encoding,
            channel_id=args.channel_id,
            serial_suffix=serial_suffix,
        )

        # Pass args that pw_system.console understands (filtered_argv already excludes --device-serial-suffix)
        sys.argv = filtered_argv

        return pw_system.console.main(
            compiled_protos=[maco_service_pb2, nfc_mock_service_pb2],
            device_connection=device_connection,
        )
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
        return 0


if __name__ == "__main__":
    sys.exit(main())
