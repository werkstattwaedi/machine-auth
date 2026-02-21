# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""MACO simulator console with hot-restart support.

Features:
- Hot restart: device.update() kills simulator, rebuilds, restarts
- Auto-reconnect on disconnect

Usage:
    bazel run //maco_firmware/apps/dev:console_sim
"""

import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from types import ModuleType

import pw_cli
from pw_console import socket_client
from pw_hdlc import rpc
from pw_log.log_decoder import timestamp_parser_ms_since_boot
from pw_stream import stream_readers
from pw_tokenizer import detokenize
from pw_system.device import Device as PwSystemDevice
from pw_system.device_connection import DeviceConnection
import pw_system.console

from maco_pb import maco_service_pb2
from maco_pb import nfc_mock_service_pb2
from ntag_key_diversification import diversify_keys

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

# Default socket address for simulator (matches pw_system defaults)
DEFAULT_SOCKET_ADDR = "localhost:33000"

# Diversification parameters — match functions/.env.local
_MASTER_KEY = bytes.fromhex("c025f541727ecd8b6eb92055c88a2a70")
_SYSTEM_NAME = "OwwMachineAuth"

# Shared terminal key (same on all tags, NOT diversified) — matches
# functions/.env.local TERMINAL_KEY and DeviceSecretsMock::kDefaultNtagTerminalKey.
_TERMINAL_KEY = bytes.fromhex("f5e4b999d5aa629f193a874529c4aa2f")


def _make_ntag424_preset(
    anti_collision_uid: bytes,
    real_uid: bytes,
    terminal_key: bytes = _TERMINAL_KEY,
) -> dict:
    """Build an NTAG424 preset with diversified keys.

    Proto fields key0-key4 map to 0-indexed NTAG424 key slots:
      key0 (slot 0) = application, key1 (slot 1) = terminal,
      key2 (slot 2) = authorization.
    """
    keys = diversify_keys(_MASTER_KEY, _SYSTEM_NAME, real_uid)
    return {
        "uid": anti_collision_uid,
        "real_uid": real_uid,
        "key0": keys["application"],
        "key1": terminal_key,
        "key2": keys["authorization"],
    }


# Tag presets for quick interactive testing.
# Real UIDs match scripts/seed-emulator.ts token IDs so that terminal checkin
# finds the corresponding Firestore documents.
TAG_PRESETS = {
    # Admin's tag (seed user: admin@example.com)
    "admin": _make_ntag424_preset(
        anti_collision_uid=b'\x04\xAA\xBB\xCC\xDD\xEE\x01',
        real_uid=bytes.fromhex("04c339aa1e1890"),
    ),
    # Mike's tag (seed user: mike@example.com)
    "mike": _make_ntag424_preset(
        anti_collision_uid=b'\x04\xAA\xBB\xCC\xDD\xEE\x02',
        real_uid=bytes.fromhex("04d449bb2f2901"),
    ),
    # Valid NTAG424 auth but UID not registered in Firestore
    "unregistered": _make_ntag424_preset(
        anti_collision_uid=b'\x04\xAA\xBB\xCC\xDD\xEE\x03',
        real_uid=bytes.fromhex("04FFFFFFFFFFFF"),
    ),
    # Wrong terminal key - firmware auth will fail
    "wrong_key": _make_ntag424_preset(
        anti_collision_uid=b'\x04\xAA\xBB\xCC\xDD\xEE\x04',
        real_uid=bytes.fromhex("04c339aa1e1890"),
        terminal_key=b'\xFF' * 16,
    ),
    # Simple ISO tag (not NTAG424) - detected as unknown
    "simple": {
        "uid": b'\x04\x01\x02\x03\x04\x05\x06',
        "sak": 0x00,
    },
}


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
        "Run via ./pw console-sim instead of bazel run directly."
    )


def _run_cmd(cmd: list[str]) -> subprocess.CompletedProcess:
    """Run a command with output captured to avoid corrupting the TUI.

    Args:
        cmd: Command and arguments to run.

    Returns:
        CompletedProcess with captured stdout/stderr.
    """
    project_root = _get_project_root()
    env = os.environ.copy()
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
        if result.stderr:
            for line in result.stderr.strip().split("\n")[-20:]:
                _LOG.error("%s", line)
    return result


class SimulatorProcess:
    """Manages the simulator subprocess."""

    def __init__(self, binary_path: Path):
        self.binary_path = binary_path
        self.process: subprocess.Popen | None = None

    def start(self) -> None:
        """Start the simulator process."""
        if self.process is not None:
            self.stop()
        _LOG.info("Starting simulator: %s", self.binary_path)
        self.process = subprocess.Popen(
            [str(self.binary_path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,  # Show errors
        )
        # Let simulator initialize and start listening on socket
        time.sleep(1.0)

    def stop(self) -> None:
        """Stop the simulator process."""
        if self.process:
            _LOG.info("Stopping simulator (pid=%d)", self.process.pid)
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _LOG.warning("Simulator didn't terminate, killing...")
                self.process.kill()
                self.process.wait()
            self.process = None

    def is_running(self) -> bool:
        """Check if simulator process is running."""
        if self.process is None:
            return False
        return self.process.poll() is None


class SimDevice(PwSystemDevice):
    """Simulator device with hot-restart support."""

    def __init__(
        self,
        simulator: SimulatorProcess,
        socket_client_ref: socket_client.SocketClient,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._simulator = simulator
        self._socket_client = socket_client_ref

    def echo(self, data: bytes) -> bytes:
        """Echo data back from the device."""
        response = self.rpcs.maco.MacoService.Echo(data=data)
        return response.response.data

    def get_device_info(self):
        """Get device information (firmware version, uptime, build target)."""
        response = self.rpcs.maco.MacoService.GetDeviceInfo()
        return response.response

    def present_tag(self, preset: str | int = "admin"):
        """Present a preset NFC tag. Use remove_tag() to remove it.

        Args:
            preset: Name from TAG_PRESETS or integer index (1-based).
                    Available: "admin", "mike", "unregistered",
                    "wrong_key", "simple"
        """
        if isinstance(preset, int):
            names = list(TAG_PRESETS.keys())
            if preset < 1 or preset > len(names):
                _LOG.error("Invalid index %d. Use 1-%d.", preset, len(names))
                return
            preset = names[preset - 1]

        tag = TAG_PRESETS.get(preset)
        if tag is None:
            _LOG.error("Unknown preset %r. Available: %s",
                       preset, ", ".join(TAG_PRESETS.keys()))
            return

        if "real_uid" in tag:
            _LOG.info("Presenting NTAG424 tag %r", preset)
            return self.rpcs.maco.NfcMockService.SimulateNtag424Arrival(**tag)
        else:
            _LOG.info("Presenting simple tag %r", preset)
            return self.rpcs.maco.NfcMockService.SimulateTagArrival(**tag)

    def remove_tag(self):
        """Remove the current tag from the NFC field."""
        return self.rpcs.maco.NfcMockService.SimulateTagDeparture()

    def list_tags(self):
        """Print available tag presets."""
        for i, (name, tag) in enumerate(TAG_PRESETS.items(), 1):
            if "real_uid" in tag:
                uid_hex = tag["real_uid"].hex()
                print(f"  {i}. {name:14s} NTAG424  uid={uid_hex}")
            else:
                print(f"  {i}. {name:14s} simple")

    def update(self, target: str | None = None) -> int:
        """Rebuild and restart simulator.

        Args:
            target: Bazel target. Defaults to //maco_firmware/apps/dev:simulator

        Returns:
            Exit code (0 on success)
        """
        target = target or "//maco_firmware/apps/dev:simulator"

        _LOG.info("Stopping simulator for update...")
        self._simulator.stop()

        _LOG.info("Building %s...", target)
        result = _run_cmd(["bazelisk", "build", target])
        if result.returncode != 0:
            # Restart old simulator so console stays usable
            _LOG.info("Restarting old simulator...")
            self._simulator.start()
            return result.returncode

        _LOG.info("Build succeeded, restarting simulator...")
        self._simulator.start()
        # Socket reconnect loop will handle reconnection
        return 0


def create_sim_connection(
    socket_addr: str,
    token_databases: list[Path],
    simulator: SimulatorProcess,
    compiled_protos: list[ModuleType] | None = None,
) -> DeviceConnection:
    """Create a device connection for the simulator with auto-reconnect."""

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

    socket_impl = socket_client.SocketClient

    def socket_disconnect_handler(
        socket_device: socket_client.SocketClient,
    ) -> None:
        """Attempts to reconnect on disconnected socket."""
        _LOG.error("Socket disconnected. Waiting for simulator to restart...")
        while True:
            try:
                time.sleep(0.5)
                socket_device.connect()
                _LOG.info("Successfully reconnected to simulator")
                break
            except Exception as e:
                _LOG.debug("Reconnect attempt failed: %s", e)
                time.sleep(1)

    # Connect with retry - simulator may still be starting
    socket_device = None
    for attempt in range(10):
        try:
            socket_device = socket_impl(
                socket_addr, on_disconnect=socket_disconnect_handler
            )
            break
        except (TimeoutError, ConnectionRefusedError, OSError) as e:
            if attempt < 9:
                _LOG.debug("Connection attempt %d failed: %s, retrying...", attempt + 1, e)
                time.sleep(0.5)
            else:
                raise RuntimeError(
                    f"Failed to connect to simulator at {socket_addr} after 10 attempts"
                ) from e

    reader = stream_readers.SelectableReader(socket_device, 8192)

    device_client = SimDevice(
        simulator=simulator,
        socket_client_ref=socket_device,
        channel_id=rpc.DEFAULT_CHANNEL_ID,
        reader=reader,
        write=socket_device.write,
        proto_library=protos,
        detokenizer=detokenizer,
        timestamp_decoder=timestamp_parser_ms_since_boot,
        rpc_timeout_s=5,
        use_rpc_logging=True,
        use_hdlc_encoding=True,
    )

    return DeviceConnection(device_client, reader, socket_device.write)


def main() -> int:
    pw_cli.log.install(level=logging.DEBUG)

    # Only parse args that pw_system.console doesn't understand
    parser = argparse.ArgumentParser(
        prog="maco-console-sim",
        description=__doc__,
        add_help=False,  # Let pw_system.console handle --help
    )
    parser.add_argument(
        "--sim-binary",
        type=Path,
        required=True,
        help="Path to simulator binary",
    )
    args, remaining_args = parser.parse_known_args()

    # Extract values we need from remaining args (without consuming them)
    socket_addr = DEFAULT_SOCKET_ADDR
    token_databases: list[Path] = []

    i = 0
    while i < len(remaining_args):
        arg = remaining_args[i]
        if arg == "--socket-addr" and i + 1 < len(remaining_args):
            socket_addr = remaining_args[i + 1]
            if socket_addr == "default":
                socket_addr = DEFAULT_SOCKET_ADDR
            i += 2
        elif arg.startswith("--socket-addr="):
            socket_addr = arg.split("=", 1)[1]
            if socket_addr == "default":
                socket_addr = DEFAULT_SOCKET_ADDR
            i += 1
        elif arg == "--token-databases":
            i += 1
            while i < len(remaining_args) and not remaining_args[i].startswith("-"):
                token_databases.append(Path(remaining_args[i]))
                i += 1
        else:
            i += 1

    # Start simulator
    simulator = SimulatorProcess(args.sim_binary)
    simulator.start()

    print("🖥️  Simulator started, connecting console...")
    print("💡 Use device.update() to rebuild and hot-restart the simulator")
    print("💡 Use device.present_tag() / device.remove_tag() for NFC testing")

    try:
        device_connection = create_sim_connection(
            socket_addr=socket_addr,
            token_databases=token_databases,
            simulator=simulator,
            compiled_protos=[maco_service_pb2, nfc_mock_service_pb2],
        )
        # Pass only the args that pw_system.console understands
        sys.argv = [sys.argv[0]] + remaining_args

        return pw_system.console.main(
            compiled_protos=[maco_service_pb2, nfc_mock_service_pb2,
                             metric_service_pb2],
            device_connection=device_connection,
        )
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
        return 0
    finally:
        # Ensure simulator is stopped on exit
        simulator.stop()


if __name__ == "__main__":
    sys.exit(main())
