# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""ASCON-AEAD128 transport layer encryption/decryption.

Frame format over TCP:
    [Device ID: 8 bytes] [Nonce: 16 bytes] [Encrypted Payload: N bytes] [Tag: 16 bytes]

The device ID is transmitted in the clear to allow the gateway to look up the
per-device key. The nonce is counter-based for replay protection.
"""

import logging
import struct
from dataclasses import dataclass
from typing import Optional, Tuple

# Try to import ascon library
try:
    import ascon  # type: ignore

    _HAVE_ASCON = True
except ImportError:
    _HAVE_ASCON = False

logger = logging.getLogger(__name__)


@dataclass
class AsconFrame:
    """A decrypted ASCON frame."""

    device_id: int
    nonce: bytes
    payload: bytes


class AsconTransport:
    """ASCON-AEAD128 transport layer for encrypting/decrypting frames."""

    # Frame component sizes
    DEVICE_ID_SIZE = 8
    NONCE_SIZE = 16
    TAG_SIZE = 16
    KEY_SIZE = 16

    # Minimum frame size: device_id + nonce + tag (empty payload)
    MIN_FRAME_SIZE = DEVICE_ID_SIZE + NONCE_SIZE + TAG_SIZE

    def __init__(self) -> None:
        """Initialize the ASCON transport.

        Raises:
            ImportError: If the ascon library is not installed.
        """
        if not _HAVE_ASCON:
            raise ImportError(
                "ASCON library required but not installed. "
                "Install with: pip install ascon"
            )

    def decrypt_frame(
        self, frame_data: bytes, key: bytes
    ) -> Tuple[Optional[AsconFrame], Optional[str]]:
        """Decrypt an incoming ASCON frame.

        Args:
            frame_data: Raw frame bytes [device_id | nonce | ciphertext | tag]
            key: 16-byte decryption key for this device

        Returns:
            Tuple of (AsconFrame, None) on success, or (None, error_message) on failure
        """
        if len(frame_data) < self.MIN_FRAME_SIZE:
            return None, f"Frame too short: {len(frame_data)} < {self.MIN_FRAME_SIZE}"

        if len(key) != self.KEY_SIZE:
            return None, f"Invalid key size: {len(key)} != {self.KEY_SIZE}"

        # Parse frame header
        device_id = struct.unpack(">Q", frame_data[: self.DEVICE_ID_SIZE])[0]
        nonce = frame_data[self.DEVICE_ID_SIZE : self.DEVICE_ID_SIZE + self.NONCE_SIZE]

        # Extract ciphertext and tag
        encrypted_payload = frame_data[
            self.DEVICE_ID_SIZE + self.NONCE_SIZE : -self.TAG_SIZE
        ]
        tag = frame_data[-self.TAG_SIZE :]

        # Decrypt using ASCON-AEAD128
        # Associated data: device_id (authenticate but don't encrypt)
        ad = frame_data[: self.DEVICE_ID_SIZE]

        try:
            plaintext = ascon.decrypt(
                key=key,
                nonce=nonce,
                associateddata=ad,
                ciphertext=encrypted_payload + tag,
                variant="Ascon-128",
            )
            if plaintext is None:
                return None, "ASCON decryption failed: authentication error"
        except Exception as e:
            return None, f"ASCON decryption error: {e}"

        return AsconFrame(device_id=device_id, nonce=nonce, payload=plaintext), None

    def encrypt_frame(
        self, device_id: int, nonce: bytes, payload: bytes, key: bytes
    ) -> Tuple[Optional[bytes], Optional[str]]:
        """Encrypt a frame for sending to a device.

        Args:
            device_id: 64-bit device identifier
            nonce: 16-byte nonce (must be unique per message)
            payload: Plaintext payload to encrypt
            key: 16-byte encryption key for this device

        Returns:
            Tuple of (frame_bytes, None) on success, or (None, error_message) on failure
        """
        if len(nonce) != self.NONCE_SIZE:
            return None, f"Invalid nonce size: {len(nonce)} != {self.NONCE_SIZE}"

        if len(key) != self.KEY_SIZE:
            return None, f"Invalid key size: {len(key)} != {self.KEY_SIZE}"

        # Build frame header
        device_id_bytes = struct.pack(">Q", device_id)

        # Encrypt using ASCON-AEAD128
        # Associated data: device_id
        try:
            ciphertext_with_tag = ascon.encrypt(
                key=key,
                nonce=nonce,
                associateddata=device_id_bytes,
                plaintext=payload,
                variant="Ascon-128",
            )
        except Exception as e:
            return None, f"ASCON encryption error: {e}"

        # Build complete frame
        frame = device_id_bytes + nonce + ciphertext_with_tag
        return frame, None

    def parse_device_id(self, frame_data: bytes) -> Optional[int]:
        """Extract device ID from frame without decryption.

        This allows looking up the device key before full decryption.

        Args:
            frame_data: Raw frame bytes

        Returns:
            Device ID or None if frame is too short
        """
        if len(frame_data) < self.DEVICE_ID_SIZE:
            return None
        return struct.unpack(">Q", frame_data[: self.DEVICE_ID_SIZE])[0]


class NonceTracker:
    """Tracks nonces for replay protection.

    Uses a sliding window to reject replayed or out-of-order nonces.
    """

    def __init__(self, window_size: int = 64) -> None:
        """Initialize the nonce tracker.

        Args:
            window_size: Number of recent nonces to track
        """
        self._window_size = window_size
        self._highest_nonce: int = 0
        self._seen_nonces: set[int] = set()

    def check_and_update(self, nonce: bytes) -> bool:
        """Check if a nonce is valid (not replayed) and update state.

        Args:
            nonce: 16-byte nonce to check

        Returns:
            True if nonce is valid, False if it's a replay
        """
        # Interpret nonce as big-endian counter
        nonce_value = int.from_bytes(nonce, byteorder="big")

        # Reject if too old (outside window)
        if nonce_value < self._highest_nonce - self._window_size:
            logger.warning(
                "Nonce too old: %d < %d",
                nonce_value,
                self._highest_nonce - self._window_size,
            )
            return False

        # Reject if already seen
        if nonce_value in self._seen_nonces:
            logger.warning("Nonce replay detected: %d", nonce_value)
            return False

        # Accept and update state
        self._seen_nonces.add(nonce_value)

        # Update highest and clean old entries
        if nonce_value > self._highest_nonce:
            self._highest_nonce = nonce_value
            # Remove entries outside window
            cutoff = self._highest_nonce - self._window_size
            self._seen_nonces = {n for n in self._seen_nonces if n >= cutoff}

        return True

    def reset(self) -> None:
        """Reset the nonce tracker state."""
        self._highest_nonce = 0
        self._seen_nonces.clear()
