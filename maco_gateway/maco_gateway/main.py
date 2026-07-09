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
import os
import secrets
import sys
from pathlib import Path
from typing import Dict, Optional

from pw_hdlc import decode as hdlc_decode
from pw_hdlc import encode as hdlc_encode
from pw_rpc import packets
from pw_rpc.descriptors import RpcIds
from pw_rpc.internal.packet_pb2 import PacketType
from pw_status import Status

from gateway.gateway_service_pb2 import (
    AcquireSensingLeaseRequest,
    ForwardRequest,
    ForwardResponse,
    LogEntry,
    LogResponse,
    PingRequest,
    PingResponse,
    RenewSensingLeaseRequest,
    SensingLeaseResponse,
)
from pw_rpc import ids as rpc_ids

from maco_gateway.ascon_transport import (
    AsconTransport,
    DeviceReplayGuard,
    NonceTracker,
)
from maco_gateway.firebase_client import FirebaseClient
from maco_gateway.gateway_service import GatewayServiceImpl
from maco_gateway.key_store import KeyStore
from maco_gateway.print_worker import PrintWorker
from maco_gateway.printer import parse_printer_endpoint
from maco_gateway.sensing.service import SensingService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# pw_rpc channel ID for gateway communication
GATEWAY_CHANNEL_ID = 1

# Pre-compute RPC IDs from proto names
_SERVICE_ID = rpc_ids.calculate("maco.gateway.GatewayService")
_METHOD_FORWARD = rpc_ids.calculate("Forward")
_METHOD_PERSIST_LOG = rpc_ids.calculate("PersistLog")
_METHOD_PING = rpc_ids.calculate("Ping")
_METHOD_ACQUIRE_SENSING_LEASE = rpc_ids.calculate("AcquireSensingLease")
_METHOD_RENEW_SENSING_LEASE = rpc_ids.calculate("RenewSensingLease")


def _sensing_spec_fields(spec) -> tuple:
    """(kind, host, port, poll_interval_sec) from a proto SensingSpec oneof."""
    which = spec.WhichOneof("backend")
    if which == "xtool_laser":
        x = spec.xtool_laser
        return "xtool_laser", x.host, x.port, x.poll_interval_sec
    if which == "mock":
        return "mock", "", 0, 0
    raise ValueError(f"empty or unknown SensingSpec backend: {which!r}")


class ClientConnection:
    """Manages a single client connection."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        key_store: KeyStore,
        gateway_service: GatewayServiceImpl,
        replay_guard: DeviceReplayGuard,
        sensing: SensingService,
    ) -> None:
        self._reader = reader
        self._writer = writer
        self._key_store = key_store
        self._gateway_service = gateway_service
        self._sensing = sensing
        self._addr = writer.get_extra_info("peername")

        self._ascon = AsconTransport()
        # Per-connection ordering/window guard (reset each connection).
        self._nonce_tracker = NonceTracker()
        # Shared across connections: catches a captured frame replayed on a
        # fresh connection, which the per-connection tracker alone cannot.
        self._replay_guard = replay_guard
        self._hdlc_decoder = hdlc_decode.FrameDecoder()

        self._device_id: Optional[bytes] = None
        self._device_key: Optional[bytes] = None
        # Seed the response nonce counter from a CSPRNG instead of 0.
        # The device key is static across connections, so starting every
        # connection at counter 1 made response #1 reuse the same
        # (key, nonce) pair on every connection — leaking the ASCON
        # keystream to an on-LAN observer. A random 32-bit start mirrors the
        # firmware request side (p2_gateway_client.cc GetRandomNonceStart)
        # and makes cross-connection nonce reuse improbable. The device does
        # not replay-check response nonces, so a random start is transparent
        # to it (the nonce travels in the frame).
        self._response_nonce_counter = secrets.randbits(32)

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
                "Device %s connected from %s", device_id.hex(), self._addr
            )
        elif self._device_id != device_id:
            logger.warning(
                "Device ID mismatch: expected %s, got %s",
                self._device_id.hex(),
                device_id.hex(),
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

        # Check nonce for replay protection. The per-connection tracker
        # enforces ordering within this connection; the shared replay guard
        # rejects a frame captured on one connection and replayed on another.
        if not self._nonce_tracker.check_and_update(frame.nonce):
            logger.warning("Nonce replay detected, dropping frame")
            return
        if not self._replay_guard.check_and_add(self._device_id, frame.nonce):
            logger.warning("Cross-connection nonce replay detected, dropping frame")
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

        rpc = RpcIds(packet.channel_id, packet.service_id,
                     packet.method_id, packet.call_id)

        if packet.service_id != _SERVICE_ID:
            logger.warning("Unknown service: %d", packet.service_id)
            return packets.encode_server_error(rpc, Status.NOT_FOUND)

        try:
            if packet.method_id == _METHOD_FORWARD:
                return await self._handle_forward(rpc, packet.payload)
            elif packet.method_id == _METHOD_PERSIST_LOG:
                return self._handle_persist_log(rpc, packet.payload)
            elif packet.method_id == _METHOD_PING:
                return self._handle_ping(rpc, packet.payload)
            elif packet.method_id == _METHOD_ACQUIRE_SENSING_LEASE:
                return await self._handle_acquire_sensing_lease(rpc, packet.payload)
            elif packet.method_id == _METHOD_RENEW_SENSING_LEASE:
                return self._handle_renew_sensing_lease(rpc, packet.payload)
            else:
                logger.warning("Unknown method: %d", packet.method_id)
                return packets.encode_server_error(rpc, Status.UNIMPLEMENTED)
        except Exception as e:
            logger.error("RPC handler error: %s", e, exc_info=True)
            return packets.encode_server_error(rpc, Status.INTERNAL)

    async def _handle_forward(self, rpc: RpcIds, payload: bytes) -> bytes:
        """Handle Forward RPC: proxy request to Firebase."""
        req = ForwardRequest()
        req.MergeFromString(payload)

        result = await self._gateway_service.forward(
            endpoint=req.endpoint,
            payload=bytes(req.payload),
            request_id=req.request_id,
            device_id=self._device_id,
        )

        resp = ForwardResponse(
            success=result["success"],
            payload=result["payload"],
            http_status=result["http_status"],
            error=result["error"],
            request_id=result["request_id"],
        )
        return packets.encode_response(rpc, resp)

    def _handle_persist_log(self, rpc: RpcIds, payload: bytes) -> bytes:
        """Handle PersistLog RPC: store log entry."""
        req = LogEntry()
        req.MergeFromString(payload)

        result = self._gateway_service.persist_log(
            timestamp_ms=req.timestamp_ms,
            level=req.level,
            module=req.module,
            message=req.message,
            data=req.data,
        )

        resp = LogResponse(
            success=result["success"],
            pending_count=result["pending_count"],
        )
        return packets.encode_response(rpc, resp)

    def _handle_ping(self, rpc: RpcIds, payload: bytes) -> bytes:
        """Handle Ping RPC: echo with timestamps."""
        req = PingRequest()
        req.MergeFromString(payload)

        result = self._gateway_service.ping(
            client_timestamp_ms=req.client_timestamp_ms,
        )

        resp = PingResponse(
            gateway_timestamp_ms=result["gateway_timestamp_ms"],
            client_timestamp_ms=result["client_timestamp_ms"],
        )
        return packets.encode_response(rpc, resp)

    async def _handle_acquire_sensing_lease(self, rpc: RpcIds, payload: bytes) -> bytes:
        """Handle AcquireSensingLease: start/reuse a prober, mint a lease."""
        req = AcquireSensingLeaseRequest()
        req.MergeFromString(payload)
        kind, host, port, poll = _sensing_spec_fields(req.spec)
        lease_id, valid, state = await self._sensing.acquire(
            kind=kind, host=host, port=port, poll_interval_sec=poll,
            ttl_sec=req.lease_ttl_sec,
        )
        resp = SensingLeaseResponse(lease_id=lease_id, valid=valid, state=int(state))
        return packets.encode_response(rpc, resp)

    def _handle_renew_sensing_lease(self, rpc: RpcIds, payload: bytes) -> bytes:
        """Handle RenewSensingLease: extend the lease and read current state."""
        req = RenewSensingLeaseRequest()
        req.MergeFromString(payload)
        lease_id, valid, state = self._sensing.renew(req.lease_id)
        resp = SensingLeaseResponse(lease_id=lease_id, valid=valid, state=int(state))
        return packets.encode_response(rpc, resp)

    async def _send_response(self, response_data: bytes) -> None:
        """Send an encrypted response to the client.

        Wire format: HDLC( ASCON( RPC ) )
        We ASCON-encrypt the RPC packet, then wrap in HDLC for framing.
        """
        if self._device_key is None or self._device_id is None:
            logger.error("Cannot send response: device not identified")
            return

        # Generate nonce for response: [device_id: 12] [counter: 4 BE].
        # Wrap in 32 bits so a random seed near 2**32 can't overflow the
        # 4-byte field; wraparound is harmless (uniqueness within a
        # connection holds for any realistic response count).
        self._response_nonce_counter = (self._response_nonce_counter + 1) & 0xFFFFFFFF
        nonce = self._device_id + self._response_nonce_counter.to_bytes(
            4, byteorder="big"
        )

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
        sensing: SensingService,
    ) -> None:
        self._host = host
        self._port = port
        self._key_store = key_store
        self._firebase_client = firebase_client
        self._sensing = sensing
        self._gateway_service = GatewayServiceImpl(firebase_client)
        self._connections: Dict[str, ClientConnection] = {}
        # One replay guard for the whole server so per-device nonce history
        # survives across connections (S-3). Bounded, so it can't grow
        # without limit even under many devices / long uptime.
        self._replay_guard = DeviceReplayGuard()

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
                reader,
                writer,
                self._key_store,
                self._gateway_service,
                self._replay_guard,
                self._sensing,
            )
            self._connections[addr] = conn
            await conn.handle()
        except Exception as e:
            logger.error("Connection handler error for %s: %s", addr, e,
                         exc_info=True)
        finally:
            self._connections.pop(addr, None)


def parse_args() -> argparse.Namespace:
    """Parse command line arguments.

    Values are resolved in order: CLI args > env vars > defaults.
    Env vars are loaded from maco_gateway/.env.local if present
    (generated by scripts/generate-env.ts).
    """
    # Load .env.local if present (generated by scripts/generate-env.ts).
    # Check Bazel runfiles first, then workspace directory, then relative path.
    env_candidates = [
        Path(__file__).parent.parent / ".env.local",  # Bazel runfiles
    ]
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", "")
    if workspace:
        env_candidates.append(Path(workspace) / "maco_gateway" / ".env.local")

    env_file = next((p for p in env_candidates if p.exists()), None)
    if env_file:
        try:
            from dotenv import load_dotenv

            load_dotenv(env_file)
        except ImportError:
            # dotenv not available — rely on env vars or CLI args
            pass

    parser = argparse.ArgumentParser(
        description="MACO Gateway - pw_rpc proxy between MACO devices and Firebase"
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("GATEWAY_HOST", "0.0.0.0"),
        help="Host to listen on (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("GATEWAY_PORT", "5000")),
        help="Port to listen on (default: 5000)",
    )
    parser.add_argument(
        "--master-key",
        default=os.environ.get("MASTER_KEY"),
        help="Master key for ASCON encryption (hex string, 32 chars = 16 bytes)",
    )
    parser.add_argument(
        "--firebase-url",
        default=os.environ.get(
            "FIREBASE_URL",
            "https://europe-west6-oww-maco.cloudfunctions.net/api",
        ),
        help="Firebase Cloud Functions URL",
    )
    parser.add_argument(
        "--gateway-api-key",
        default=os.environ.get("GATEWAY_API_KEY", ""),
        help="API key for authenticating with Firebase (GATEWAY_API_KEY)",
    )
    parser.add_argument(
        "--printer-host",
        default=os.environ.get("PRINTER_HOST", ""),
        help=(
            "host[:port] of the Brother label printer (e.g. "
            "labeler.internal:9100). When set, the gateway runs the "
            "Firestore-driven print worker. Unset → no printing."
        ),
    )
    parser.add_argument(
        "--gcp-project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT")
        or os.environ.get("GCP_PROJECT"),
        help=(
            "GCP project id for the Firestore print-job listener. Defaults "
            "to the project in the service-account credentials."
        ),
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )
    args = parser.parse_args()

    if not args.master_key:
        parser.error(
            "--master-key is required (or set MASTER_KEY env var / .env.local)"
        )

    return args


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

    if not args.gateway_api_key:
        logger.error("--gateway-api-key is required")
        return 1

    logger.info("Starting MACO Gateway")
    logger.info("  Host: %s", args.host)
    logger.info("  Port: %d", args.port)
    logger.info("  Firebase URL: %s", args.firebase_url)

    key_store = KeyStore(master_key)
    firebase_client = FirebaseClient(
        args.firebase_url,
        api_key=args.gateway_api_key,
    )

    # Machine-activity sensing (ADR-0035): the terminal leases a sensing
    # session and polls it; the gateway runs the device protocol in the
    # background. Always available (probers are created lazily on first lease).
    sensing = SensingService()

    server = GatewayServer(
        host=args.host,
        port=args.port,
        key_store=key_store,
        firebase_client=firebase_client,
        sensing=sensing,
    )

    # Optional label print worker: only started when a printer is configured.
    printer = parse_printer_endpoint(args.printer_host)
    worker = None
    if printer is not None:
        printer_host, printer_port = printer
        worker = PrintWorker(printer_host, printer_port, project=args.gcp_project)
        logger.info("  Printer: %s:%d", printer_host, printer_port)

    async def serve() -> None:
        tasks = [server.run(), sensing.run_reaper()]
        if worker is not None:
            tasks.append(worker.run())
        await asyncio.gather(*tasks)

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        logger.info("Shutting down")
    except Exception as e:
        logger.error("Fatal error: %s", e)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
