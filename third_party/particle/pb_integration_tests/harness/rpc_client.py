# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""pw_rpc client for integration tests over USB serial.

Provides a simple RPC client that communicates with P2 devices
using HDLC-encoded pw_rpc over USB serial.
"""

import logging
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, Iterable

import serial
from pw_hdlc import rpc as hdlc_rpc
from pw_hdlc.decode import Frame, FrameDecoder
from pw_hdlc import encode as hdlc_encode
import pw_rpc
from pw_rpc import callback_client
from pw_stream import stream_readers
from pw_protobuf_compiler import python_protos

_LOG = logging.getLogger(__name__)


class RpcClient:
    """An RPC client for P2 devices over USB serial with HDLC encoding.

    This client handles:
    - Serial port communication
    - HDLC frame encoding/decoding
    - pw_rpc packet processing

    Example:
        client = RpcClient(
            port="/dev/ttyACM0",
            proto_paths=[Path("test.proto")],
            channel_id=1,
        )
        client.start()
        try:
            result = client.rpcs.my_package.MyService.MyMethod(arg=42)
        finally:
            client.stop()
    """

    # Default pw_rpc channel ID
    DEFAULT_CHANNEL_ID = 1

    # Default HDLC address for RPC
    DEFAULT_HDLC_ADDRESS = ord("R")

    def __init__(
        self,
        port: str,
        proto_paths: Iterable[Path | ModuleType],
        channel_id: int = DEFAULT_CHANNEL_ID,
        hdlc_address: int = DEFAULT_HDLC_ADDRESS,
        baud_rate: int = 115200,
        rpc_timeout_s: float = 5.0,
    ) -> None:
        """Initialize the RPC client.

        Args:
            port: Serial port path (e.g., "/dev/ttyACM0").
            proto_paths: Paths to .proto files or proto modules.
            channel_id: pw_rpc channel ID.
            hdlc_address: HDLC frame address.
            baud_rate: Serial baud rate.
            rpc_timeout_s: Default RPC timeout in seconds.
        """
        self._port_path = port
        self._proto_paths = list(proto_paths)
        self._channel_id = channel_id
        self._hdlc_address = hdlc_address
        self._baud_rate = baud_rate
        self._rpc_timeout_s = rpc_timeout_s

        self._serial: serial.Serial | None = None
        self._reader_and_executor: stream_readers.DataReaderAndExecutor | None = (
            None
        )
        self._client: pw_rpc.Client | None = None
        self._protos: python_protos.Library | None = None

    def start(self) -> None:
        """Start the RPC client and open the serial connection.

        Raises:
            RuntimeError: If client is already started.
            serial.SerialException: If serial port cannot be opened.
        """
        if self._serial is not None:
            raise RuntimeError("RPC client already started")

        _LOG.info("Opening serial port %s", self._port_path)
        self._serial = serial.Serial(
            self._port_path,
            baudrate=self._baud_rate,
            timeout=0.1,
        )

        # Load proto definitions
        self._protos = python_protos.Library.from_paths(self._proto_paths)

        # Create callback client with timeouts
        client_impl = callback_client.Impl(
            default_unary_timeout_s=self._rpc_timeout_s,
            default_stream_timeout_s=None,
        )

        # Create channel with HDLC encoding
        def write_hdlc(data: bytes) -> None:
            frame = hdlc_encode.ui_frame(self._hdlc_address, data)
            _LOG.debug("TX %d bytes", len(frame))
            if self._serial:
                self._serial.write(frame)

        channel = pw_rpc.Channel(self._channel_id, write_hdlc)

        # Create RPC client
        self._client = pw_rpc.Client.from_modules(
            client_impl, [channel], self._protos.modules()
        )

        # Create HDLC frame decoder
        hdlc_decoder = FrameDecoder()

        def process_data(data: bytes) -> Iterable[bytes]:
            """Decode HDLC frames and yield RPC packets."""
            for byte in data:
                result = hdlc_decoder.process_byte(byte)
                if result:
                    if result.ok():
                        frame = result.value()
                        if frame.address == self._hdlc_address:
                            yield bytes(frame.data)
                        else:
                            _LOG.debug(
                                "Ignoring frame with address %d", frame.address
                            )
                    else:
                        _LOG.warning("HDLC decode error: %s", result.status())

        def on_read_error(exc: Exception) -> None:
            _LOG.error("Serial read error: %s", exc)

        # Create serial reader
        reader = stream_readers.SerialReader(self._serial, 8192)

        # Create data reader and executor
        self._reader_and_executor = stream_readers.DataReaderAndExecutor(
            reader,
            on_read_error,
            process_data,
            self._handle_rpc_packet,
        )
        self._reader_and_executor.start()

        _LOG.info("RPC client started on %s", self._port_path)

    def stop(self) -> None:
        """Stop the RPC client and close the serial connection."""
        if self._reader_and_executor:
            self._reader_and_executor.stop()
            self._reader_and_executor = None

        if self._serial:
            self._serial.close()
            self._serial = None

        self._client = None
        _LOG.info("RPC client stopped")

    def _handle_rpc_packet(self, packet: bytes) -> None:
        """Process an incoming RPC packet."""
        if self._client:
            if not self._client.process_packet(packet):
                _LOG.warning("Packet not handled by RPC client")

    @property
    def rpcs(self) -> Any:
        """Access RPC services on the device.

        Returns:
            Object for accessing RPC services. Access methods as:
            `rpcs.package_name.ServiceName.MethodName(args)`

        Raises:
            RuntimeError: If client is not started.
        """
        if self._client is None:
            raise RuntimeError("RPC client not started")
        return self._client.channel(self._channel_id).rpcs

    @property
    def client(self) -> pw_rpc.Client:
        """Get the underlying pw_rpc Client.

        Raises:
            RuntimeError: If client is not started.
        """
        if self._client is None:
            raise RuntimeError("RPC client not started")
        return self._client

    def __enter__(self) -> "RpcClient":
        self.start()
        return self

    def __exit__(self, *exc_info) -> None:
        self.stop()
