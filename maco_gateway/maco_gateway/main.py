#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""MACO Gateway main entry point.

The gateway acts as a proxy between MACO devices and Firebase Cloud Functions:
- Listens for TCP connections from MACO devices on port 5000
- Decrypts ASCON-encrypted HDLC frames
- Handles pw_rpc requests using GatewayService
- Forwards requests to Firebase via HTTPS
- Returns encrypted responses to devices

Usage:
    python -m maco_gateway.main --port 5000 --master-key <hex_key>

Or with Bazel:
    bazel run //maco_gateway:maco_gateway -- --port 5000 --master-key <hex_key>
"""

import argparse
import asyncio
import logging
import sys
from typing import Dict, Optional

from pw_hdlc import decode as hdlc_decode
from pw_hdlc import encode as hdlc_encode
from pw_rpc import packets
from pw_rpc.descriptors import RpcIds
from pw_rpc.internal.packet_pb2 import PacketType
from pw_status import Status

from maco_gateway.ascon_transport import AsconTransport, NonceTracker
from maco_gateway.firebase_client import FirebaseClient
from maco_gateway.gateway_service import GatewayServiceImpl
from maco_gateway.key_store import KeyStore

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# pw_rpc channel ID for gateway communication
GATEWAY_CHANNEL_ID = 1


class ClientConnection:
    """Manages a single client connection."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        key_store: KeyStore,
        gateway_service: GatewayServiceImpl,
    ) -> None:
        self._reader = reader
        self._writer = writer
        self._key_store = key_store
        self._gateway_service = gateway_service
        self._addr = writer.get_extra_info("peername")

        self._ascon = AsconTransport()
        self._nonce_tracker = NonceTracker()
        self._hdlc_decoder = hdlc_decode.FrameDecoder()

        self._device_id: Optional[int] = None
        self._device_key: Optional[bytes] = None
        self._response_nonce_counter = 0

    async def handle(self) -> None:
        """Handle the client connection."""
        logger.info("New connection from %s", self._addr)

        try:
            await self._process_messages()
        except asyncio.CancelledError:
            logger.info("Connection cancelled: %s", self._addr)
        except Exception as e:
            logger.error("Error handling client %s: %s", self._addr, e)
        finally:
            logger.info("Connection closed: %s", self._addr)
            self._writer.close()
            await self._writer.wait_closed()

    async def _process_messages(self) -> None:
        """Process incoming messages from the client.

        Wire format: HDLC( ASCON( RPC ) )
        The device wraps ASCON-encrypted frames in HDLC for framing over TCP.
        We HDLC-decode first to get complete ASCON frames, then decrypt.
        """
        while True:
            data = await self._reader.read(4096)
            if not data:
                break

            logger.debug("Received %d bytes from %s", len(data), self._addr)

            # Feed bytes to HDLC decoder - it handles framing
            for frame in self._hdlc_decoder.process_valid_frames(data):
                await self._process_ascon_frame(bytes(frame.data))

    async def _process_ascon_frame(self, frame_data: bytes) -> None:
        """Decrypt an ASCON frame extracted from HDLC and process the RPC payload."""
        if len(frame_data) < AsconTransport.MIN_FRAME_SIZE:
            logger.warning("ASCON frame too small: %d bytes", len(frame_data))
            return

        # Parse device ID to look up key
        device_id = self._ascon.parse_device_id(frame_data)
        if device_id is None:
            logger.warning("Failed to parse device ID")
            return

        # Get or validate device key
        if self._device_id is None:
            self._device_id = device_id
            self._device_key = self._key_store.get_device_key(device_id)
            logger.info(
                "Device %016X connected from %s", device_id, self._addr
            )
        elif self._device_id != device_id:
            logger.warning(
                "Device ID mismatch: expected %016X, got %016X",
                self._device_id,
                device_id,
            )
            return

        # Decrypt the ASCON frame
        frame, error = self._ascon.decrypt_frame(frame_data, self._device_key)
        if error:
            logger.warning("Decrypt error: %s", error)
            return

        if frame is None:
            logger.warning("Decrypt returned None frame")
            return

        # Check nonce for replay protection
        if not self._nonce_tracker.check_and_update(frame.nonce):
            logger.warning("Nonce replay detected, dropping frame")
            return

        # The decrypted payload is a raw pw_rpc packet
        await self._process_rpc_packet(frame.payload)

    async def _process_rpc_packet(self, packet_data: bytes) -> None:
        """Process a pw_rpc packet."""
        try:
            packet = packets.decode(packet_data)
        except Exception as e:
            logger.warning("Failed to decode RPC packet: %s", e)
            return

        logger.debug("RPC packet: type=%s, service=%d, method=%d",
                     packet.type, packet.service_id, packet.method_id)

        # Handle the RPC request
        response = await self._handle_rpc_request(packet)
        if response:
            await self._send_response(response)

    async def _handle_rpc_request(self, packet) -> Optional[bytes]:
        """Handle an RPC request and return the response packet."""
        if not packets.for_server(packet):
            logger.debug("Ignoring non-server packet type=%d", packet.type)
            return None

        logger.info(
            "RPC request: service=%d method=%d call=%d",
            packet.service_id,
            packet.method_id,
            packet.call_id,
        )

        # TODO: Implement proper RPC dispatch using generated proto code
        # For now, return UNIMPLEMENTED for all requests
        rpc = RpcIds(packet.channel_id, packet.service_id,
                     packet.method_id, packet.call_id)
        return packets.encode_server_error(rpc, Status.UNIMPLEMENTED)

    async def _send_response(self, response_data: bytes) -> None:
        """Send an encrypted response to the client.

        Wire format: HDLC( ASCON( RPC ) )
        We ASCON-encrypt the RPC packet, then wrap in HDLC for framing.
        """
        if self._device_key is None or self._device_id is None:
            logger.error("Cannot send response: device not identified")
            return

        # Generate nonce for response
        self._response_nonce_counter += 1
        nonce = self._response_nonce_counter.to_bytes(16, byteorder="big")

        # ASCON encrypt the raw RPC packet
        frame_data, error = self._ascon.encrypt_frame(
            self._device_id, nonce, response_data, self._device_key
        )
        if error:
            logger.error("Encrypt error: %s", error)
            return

        # HDLC encode the ASCON frame for TCP framing
        hdlc_data = hdlc_encode.ui_frame(GATEWAY_CHANNEL_ID, frame_data)

        # Send to client
        self._writer.write(hdlc_data)
        await self._writer.drain()


class GatewayServer:
    """MACO Gateway TCP server."""

    def __init__(
        self,
        host: str,
        port: int,
        key_store: KeyStore,
        firebase_client: FirebaseClient,
    ) -> None:
        self._host = host
        self._port = port
        self._key_store = key_store
        self._firebase_client = firebase_client
        self._gateway_service = GatewayServiceImpl(firebase_client)
        self._connections: Dict[str, ClientConnection] = {}

    async def run(self) -> None:
        """Run the gateway server."""
        server = await asyncio.start_server(
            self._handle_connection, self._host, self._port
        )

        addrs = ", ".join(str(sock.getsockname()) for sock in server.sockets)
        logger.info("MACO Gateway listening on %s", addrs)

        async with server:
            await server.serve_forever()

    async def _handle_connection(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """Handle a new client connection."""
        addr = str(writer.get_extra_info("peername"))
        try:
            conn = ClientConnection(
                reader, writer, self._key_store, self._gateway_service
            )
            self._connections[addr] = conn
            await conn.handle()
        except Exception as e:
            logger.error("Connection handler error for %s: %s", addr, e,
                         exc_info=True)
        finally:
            self._connections.pop(addr, None)


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="MACO Gateway - pw_rpc proxy between MACO devices and Firebase"
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to listen on (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5000,
        help="Port to listen on (default: 5000)",
    )
    parser.add_argument(
        "--master-key",
        required=True,
        help="Master key for ASCON encryption (hex string, 32 chars = 16 bytes)",
    )
    parser.add_argument(
        "--firebase-url",
        default="https://us-central1-machine-auth.cloudfunctions.net",
        help="Firebase Cloud Functions URL",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )
    return parser.parse_args()


def main() -> int:
    """Main entry point."""
    args = parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    try:
        master_key = bytes.fromhex(args.master_key)
        if len(master_key) != 16:
            logger.error("Master key must be 16 bytes (32 hex characters)")
            return 1
    except ValueError as e:
        logger.error("Invalid master key: %s", e)
        return 1

    logger.info("Starting MACO Gateway")
    logger.info("  Host: %s", args.host)
    logger.info("  Port: %d", args.port)
    logger.info("  Firebase URL: %s", args.firebase_url)

    key_store = KeyStore(master_key)
    firebase_client = FirebaseClient(args.firebase_url)

    server = GatewayServer(
        host=args.host,
        port=args.port,
        key_store=key_store,
        firebase_client=firebase_client,
    )

    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        logger.info("Shutting down")
    except Exception as e:
        logger.error("Fatal error: %s", e)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
