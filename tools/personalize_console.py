# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""MACO personalize console for NFC tag key provisioning.

Connects to personalize firmware over serial, subscribes to tag events,
and sends pre-diversified keys when a factory tag is detected.

Secrets are loaded from functions/.env.local (dev) or gcloud Secret Manager
(--prod).

Usage:
    ./pw personalize-console
    bazel run //maco_firmware/apps/personalize:console -- --device /dev/ttyACM0
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
import pw_cli.log
from pw_console import embed as pw_embed
from pw_console import python_logging as pw_logging
from pw_console import pyserial_wrapper
from pw_console import socket_client
from pw_console.log_store import LogStore
from pw_hdlc import rpc
from pw_log.log_decoder import timestamp_parser_ms_since_boot
from pw_stream import stream_readers
from pw_tokenizer import detokenize
from pw_system.device import Device as PwSystemDevice
from pw_system.device_connection import (
    add_device_args,
    DeviceConnection,
)
from pw_rpc.console_tools.console import flattened_rpc_completions

from maco_pb import maco_service_pb2
from maco_pb import personalization_service_pb2

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

# Default system name for key diversification
_SYSTEM_NAME = "OwwMachineAuth"


class ReconnectingSerialClient:
    """Serial client with automatic reconnection on disconnect."""

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
        self.connect_to(self._device)

    def connect_to(self, device: str) -> None:
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
            device, self._baudrate, timeout=self._timeout,
        )
        self._device = device
        self._connected = True
        _LOG.info("Connected to %s", device)

    def write(self, data: bytes) -> int | None:
        if not self._connected or self._serial is None:
            raise Exception("Serial is not connected.")
        try:
            return self._serial.write(data)
        except (OSError, serial.SerialException) as e:
            _LOG.error("Write error: %s", e)
            self._handle_disconnect()
            return self._serial.write(data) if self._serial else None

    def read(self, num_bytes: int = DEFAULT_MAX_READ_SIZE) -> bytes:
        if not self._connected or self._serial is None:
            raise Exception("Serial is not connected.")
        try:
            data = self._serial.read(num_bytes)
            return data if data else b""
        except (OSError, serial.SerialException) as e:
            _LOG.error("Read error: %s", e)
            self._handle_disconnect()
            return b""

    def _handle_disconnect(self) -> None:
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
        if self._serial is None:
            return -1
        try:
            return self._serial.fileno()
        except Exception:
            return -1

    def close(self) -> None:
        if self._serial:
            self._serial.close()
            self._serial = None
        self._connected = False


def wait_for_device(device_path: str, timeout: float = 30.0) -> bool:
    """Wait for device to appear at the given path."""
    start = time.time()
    while time.time() - start < timeout:
        if '*' in device_path:
            matches = glob.glob(device_path)
            if matches:
                return True
        elif os.path.exists(device_path):
            return True
        time.sleep(0.5)
    return False


def load_secrets_dev() -> dict[str, str]:
    """Load secrets from functions/.env.local for development."""
    project_root = os.environ.get(
        "MACO_PROJECT_ROOT",
        str(Path(__file__).resolve().parent.parent),
    )
    env_file = Path(project_root) / "functions" / ".env.local"
    if not env_file.exists():
        raise FileNotFoundError(
            f"Dev secrets file not found: {env_file}\n"
            "Run from project root or set MACO_PROJECT_ROOT."
        )

    secrets = {}
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            secrets[key.strip()] = value.strip()

    required = ["DIVERSIFICATION_MASTER_KEY", "TERMINAL_KEY"]
    for key in required:
        if key not in secrets:
            raise KeyError(f"Missing {key} in {env_file}")

    return secrets


def load_secrets_prod() -> dict[str, str]:
    """Load secrets from Google Cloud Secret Manager."""
    secrets = {}
    for name in ["DIVERSIFICATION_MASTER_KEY", "TERMINAL_KEY"]:
        try:
            result = subprocess.run(
                ["gcloud", "secrets", "versions", "access", "latest",
                 "--secret", name],
                capture_output=True, text=True, check=True,
            )
            secrets[name] = result.stdout.strip()
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"Failed to fetch secret {name} from gcloud: {e.stderr}"
            ) from e
        except FileNotFoundError:
            raise RuntimeError(
                "gcloud CLI not found. Install Google Cloud SDK."
            )

    return secrets


class PersonalizeDevice(PwSystemDevice):
    """Device wrapper with personalization RPC helpers."""

    def __init__(self, serial_suffix: str | None = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._serial_suffix = serial_suffix

    @property
    def serial_suffix(self) -> str | None:
        return self._serial_suffix

    def echo(self, data: bytes = b"hello") -> bytes:
        """Echo data back from the device."""
        response = self.rpcs.maco.MacoService.Echo(data=data)
        return response.response.data

    def get_device_info(self):
        """Get device information."""
        response = self.rpcs.maco.MacoService.GetDeviceInfo()
        return response.response


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
        device_pattern = f"/dev/particle_*{serial_suffix}" if serial_suffix else device

        def disconnect_handler(serial_client: ReconnectingSerialClient) -> None:
            _LOG.error("Serial disconnected. Waiting for device to reappear...")
            while True:
                if wait_for_device(device_pattern, timeout=1.0):
                    if "*" in device_pattern:
                        matches = glob.glob(device_pattern)
                        actual_device = matches[0] if matches else device
                    else:
                        actual_device = device
                    try:
                        time.sleep(0.5)
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
        socket_impl = (
            socket_client.SocketClientWithLogging
            if serial_debug
            else socket_client.SocketClient
        )

        def socket_disconnect_handler(
            socket_device: socket_client.SocketClient,
        ) -> None:
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

    device_client = PersonalizeDevice(
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


PERSONALIZE_PROTOS = [
    maco_service_pb2,
    personalization_service_pb2,
]


WELCOME_MSG = """\
Welcome to the MACO Personalize Console!

Help: Press F1 or click the [Help] menu
To move focus: Press Shift-Tab or click on a window

Personalize pane: Tags auto-detected, press 'p' to personalize.
Press 'a' to toggle auto mode (personalizes every factory tag on tap).

REPL examples:
  device.echo()
  device.get_device_info()
"""


def main() -> int:
    from tools.personalize_pane import PersonalizePane

    serial_suffix = None
    use_prod = False
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
        elif arg == "--prod":
            use_prod = True
            i += 1
        else:
            filtered_argv.append(arg)
            i += 1

    parser = argparse.ArgumentParser(
        prog="maco-personalize-console",
        description=__doc__,
    )
    parser = add_device_args(parser)
    args, _remaining_args = parser.parse_known_args(filtered_argv[1:])

    # Load secrets
    try:
        if use_prod:
            print("Loading secrets from Google Cloud Secret Manager...")
            secrets = load_secrets_prod()
        else:
            print("Loading secrets from functions/.env.local...")
            secrets = load_secrets_dev()
    except (FileNotFoundError, KeyError, RuntimeError) as e:
        print(f"Error loading secrets: {e}")
        return 1

    master_key = bytes.fromhex(secrets["DIVERSIFICATION_MASTER_KEY"])
    terminal_key = bytes.fromhex(secrets["TERMINAL_KEY"])
    system_name = secrets.get("DIVERSIFICATION_SYSTEM_NAME", _SYSTEM_NAME)

    if len(master_key) != 16:
        print("Error: DIVERSIFICATION_MASTER_KEY must be 16 bytes (32 hex)")
        return 1
    if len(terminal_key) != 16:
        print("Error: TERMINAL_KEY must be 16 bytes (32 hex)")
        return 1

    mode_label = "PROD" if use_prod else "DEV"
    print(f"Secrets loaded ({mode_label}): master_key=...{master_key[-2:].hex()}, "
          f"terminal_key=...{terminal_key[-2:].hex()}")

    is_serial = args.device is not None

    if is_serial and not os.path.exists(args.device):
        print(f"Waiting for device {args.device}...")
        if not wait_for_device(args.device):
            print(f"Device {args.device} not found")
            return 1
        print(f"Device {args.device} found")
        time.sleep(0.5)

    try:
        if serial_suffix:
            print(f"Connected to {args.device} (serial: ...{serial_suffix})")

        device_connection = create_connection(
            device=args.device,
            baudrate=args.baudrate,
            token_databases=args.token_databases or [],
            socket_addr=args.socket_addr,
            serial_debug=args.serial_debug,
            compiled_protos=list(PERSONALIZE_PROTOS),
            rpc_logging=args.rpc_logging,
            hdlc_encoding=args.hdlc_encoding,
            channel_id=args.channel_id,
            serial_suffix=serial_suffix,
        )

        # Set up log stores for pw_console log windows
        _DEVICE_LOG = logging.getLogger("pw_rpc_device")
        _DEVICE_LOG.propagate = False
        device_log_store = LogStore()
        root_log_store = LogStore()
        _DEVICE_LOG.addHandler(device_log_store)
        logging.getLogger().addHandler(root_log_store)

        logfile = pw_logging.create_temp_log_file()
        pw_cli.log.install(
            level=logging.DEBUG, use_color=False, log_file=logfile
        )

        with device_connection as device_client:
            personalize_pane = PersonalizePane(
                device=device_client,
                master_key=master_key,
                terminal_key=terminal_key,
                system_name=system_name,
            )

            console = pw_embed.PwConsoleEmbed(
                global_vars={
                    "device": device_client,
                    "rpcs": device_client.rpcs,
                    "personalize": personalize_pane,
                },
                loggers={
                    "Device Logs": device_log_store,
                    "Host Logs": root_log_store,
                },
                repl_startup_message=WELCOME_MSG,
            )
            console.add_sentence_completer(
                flattened_rpc_completions([device_client.info()])
            )
            console.add_window_plugin(personalize_pane)
            console.setup_python_logging(last_resort_filename=logfile)
            console.embed()

        return 0
    except KeyboardInterrupt:
        print("\nGoodbye!")
        return 0


if __name__ == "__main__":
    sys.exit(main())
