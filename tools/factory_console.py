# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""MACO factory console for hardware testing and provisioning.

Extends the standard console with factory-specific commands:
- LED tests (set color, individual pixels, clear)
- Display tests (fill color, color bars, brightness)
- Device secrets provisioning (provision, check, clear)

Usage:
    ./pw factory-console
    bazel run //maco_firmware/apps/factory:console -- --device /dev/ttyACM0
"""

import argparse
import glob
import logging
import os
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
from maco_pb import factory_test_service_pb2
from maco_pb import device_secrets_service_pb2

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


# Named color presets
LED_COLORS = {
    "red": (255, 0, 0, 0),
    "green": (0, 255, 0, 0),
    "blue": (0, 0, 255, 0),
    "white": (0, 0, 0, 255),
    "yellow": (255, 255, 0, 0),
    "cyan": (0, 255, 255, 0),
    "magenta": (255, 0, 255, 0),
    "off": (0, 0, 0, 0),
}


class FactoryDevice(PwSystemDevice):
    """Factory device with hardware test and provisioning commands."""

    def __init__(self, serial_suffix: str | None = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._serial_suffix = serial_suffix

    @property
    def serial_suffix(self) -> str | None:
        return self._serial_suffix

    # ── LED Tests ──────────────────────────────────────────────────────

    def led_all(self, color: str = "red"):
        """Set all LEDs to a named color.

        Colors: red, green, blue, white, yellow, cyan, magenta, off
        """
        if color not in LED_COLORS:
            print(f"Unknown color '{color}'. Available: {', '.join(LED_COLORS)}")
            return
        r, g, b, w = LED_COLORS[color]
        resp = self.rpcs.maco.factory.FactoryTestService.LedSetAll(
            r=r, g=g, b=b, w=w
        )
        print(f"LED all -> {color}: {resp.response.message}")

    def led_rgb(self, r: int = 0, g: int = 0, b: int = 0, w: int = 0):
        """Set all LEDs to specific RGBW values (0-255)."""
        resp = self.rpcs.maco.factory.FactoryTestService.LedSetAll(
            r=r, g=g, b=b, w=w
        )
        print(f"LED all -> ({r},{g},{b},{w}): {resp.response.message}")

    def led_pixel(self, index: int, r: int = 0, g: int = 0, b: int = 0, w: int = 0):
        """Set a single LED pixel to RGBW values."""
        resp = self.rpcs.maco.factory.FactoryTestService.LedSetPixel(
            index=index, r=r, g=g, b=b, w=w
        )
        print(f"LED [{index}] -> ({r},{g},{b},{w}): {resp.response.message}")

    def led_clear(self):
        """Turn off all LEDs."""
        resp = self.rpcs.maco.factory.FactoryTestService.LedClear()
        print(f"LED clear: {resp.response.message}")

    def led_test(self):
        """Run LED test sequence: R, G, B, W, then pixel walk."""
        import time as _time

        for color in ["red", "green", "blue", "white"]:
            self.led_all(color)
            _time.sleep(1)

        self.led_clear()
        _time.sleep(0.3)

        # Walk individual pixels
        for i in range(16):
            self.led_pixel(i, w=128)
            _time.sleep(0.15)

        _time.sleep(1)
        self.led_clear()
        print("LED test complete")

    # ── Display Tests ──────────────────────────────────────────────────

    def display_brightness(self, level: int):
        """Set display backlight brightness (0-255)."""
        resp = self.rpcs.maco.factory.FactoryTestService.DisplaySetBrightness(
            brightness=level
        )
        print(f"Brightness -> {level}: {resp.response.message}")

    def display_fill(self, r: int = 255, g: int = 255, b: int = 255):
        """Fill display with a solid color (RGB 0-255)."""
        resp = self.rpcs.maco.factory.FactoryTestService.DisplayFillColor(
            r=r, g=g, b=b
        )
        color_hex = f"#{r:02x}{g:02x}{b:02x}"
        print(f"Display fill {color_hex}: {resp.response.message}")

    def display_white(self):
        """Fill display with white."""
        self.display_fill(255, 255, 255)

    def display_red(self):
        """Fill display with red."""
        self.display_fill(255, 0, 0)

    def display_green(self):
        """Fill display with green."""
        self.display_fill(0, 255, 0)

    def display_blue(self):
        """Fill display with blue."""
        self.display_fill(0, 0, 255)

    def display_black(self):
        """Fill display with black."""
        self.display_fill(0, 0, 0)

    def display_color_bars(self):
        """Show color bar test pattern (R/G/B/W/C/M/Y)."""
        resp = self.rpcs.maco.factory.FactoryTestService.DisplayColorBars()
        print(f"Color bars: {resp.response.message}")

    # ── Provisioning ───────────────────────────────────────────────────

    def check_secrets(self):
        """Check if device secrets are provisioned."""
        resp = self.rpcs.maco.secrets.DeviceSecretsService.GetStatus()
        provisioned = resp.response.is_provisioned
        status = "PROVISIONED" if provisioned else "NOT PROVISIONED"
        print(f"Device secrets: {status}")
        return provisioned

    def provision_secrets(self, gateway_secret: str, ntag_key: str):
        """Provision device secrets.

        Args:
            gateway_secret: 16-byte gateway master secret as hex string (32 chars)
            ntag_key: 16-byte NTAG terminal key as hex string (32 chars)
        """
        try:
            gw_bytes = bytes.fromhex(gateway_secret)
            ntag_bytes = bytes.fromhex(ntag_key)
        except ValueError:
            print("Error: secrets must be valid hex strings")
            return

        if len(gw_bytes) != 16 or len(ntag_bytes) != 16:
            print("Error: secrets must be exactly 16 bytes (32 hex chars)")
            return

        resp = self.rpcs.maco.secrets.DeviceSecretsService.Provision(
            gateway_master_secret=gw_bytes,
            ntag_terminal_key=ntag_bytes,
        )
        if resp.response.success:
            print("Secrets provisioned successfully")
        else:
            print(f"Provisioning failed: {resp.response.error}")

    def clear_secrets(self):
        """Clear all provisioned secrets. WARNING: Erases keys permanently."""
        resp = self.rpcs.maco.secrets.DeviceSecretsService.Clear()
        if resp.response.success:
            print("Secrets cleared")
        else:
            print(f"Clear failed: {resp.response.error}")

    # ── Device Info ────────────────────────────────────────────────────

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

    device_client = FactoryDevice(
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


FACTORY_PROTOS = [
    maco_service_pb2,
    factory_test_service_pb2,
    device_secrets_service_pb2,
]


WELCOME_MSG = """\
Welcome to the MACO Factory Console!

Help: Press F1 or click the [Help] menu
To move focus: Press Shift-Tab or click on a window

Factory Test pane: Navigate with j/k, run with Enter, confirm with p/f.
Press 'a' to run all steps sequentially.

REPL examples:
  device.echo()
  device.led_all("red")
  device.check_secrets()
"""


def main() -> int:
    from tools.factory_test_pane import FactoryTestPane

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

    parser = argparse.ArgumentParser(
        prog="maco-factory-console",
        description=__doc__,
    )
    parser = add_device_args(parser)
    args, _remaining_args = parser.parse_known_args(filtered_argv[1:])

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
            compiled_protos=list(FACTORY_PROTOS),
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
            factory_pane = FactoryTestPane(device=device_client)

            console = pw_embed.PwConsoleEmbed(
                global_vars={
                    "device": device_client,
                    "rpcs": device_client.rpcs,
                    "factory": factory_pane,
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
            console.add_window_plugin(factory_pane)
            console.setup_python_logging(last_resort_filename=logfile)
            console.embed()

        return 0
    except KeyboardInterrupt:
        print("\nGoodbye!")
        return 0


if __name__ == "__main__":
    sys.exit(main())
