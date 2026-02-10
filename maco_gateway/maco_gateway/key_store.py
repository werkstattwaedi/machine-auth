# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Per-device key management using ASCON-Hash key derivation.

The key store derives per-device encryption keys from a master secret:
    device_key = ASCON-Hash(master_secret || device_id)

This ensures each device has a unique key while allowing the gateway
to derive any device's key on demand.
"""

import hashlib
from typing import Dict

# Try to import ascon library, fall back to hashlib for development
try:
    import ascon  # type: ignore

    _HAVE_ASCON = True
except ImportError:
    _HAVE_ASCON = False


class KeyStore:
    """Manages per-device encryption keys derived from master secret."""

    # Key and device ID sizes
    KEY_SIZE = 16  # 128-bit keys
    DEVICE_ID_SIZE = 12  # 12-byte hardware device IDs

    def __init__(self, master_key: bytes) -> None:
        """Initialize the key store with a master secret.

        Args:
            master_key: 16-byte master secret for key derivation
        """
        if len(master_key) != self.KEY_SIZE:
            raise ValueError(
                f"Master key must be {self.KEY_SIZE} bytes, got {len(master_key)}"
            )
        self._master_key = master_key
        self._key_cache: Dict[bytes, bytes] = {}

    def get_device_key(self, device_id: bytes) -> bytes:
        """Get the encryption key for a device.

        Keys are derived using ASCON-Hash:
            device_key = ASCON-Hash(master_key || device_id)[0:16]

        Args:
            device_id: 12-byte device identifier

        Returns:
            16-byte device-specific encryption key
        """
        if device_id in self._key_cache:
            return self._key_cache[device_id]

        # Derive key: Hash(master_key || device_id)
        input_data = self._master_key + device_id

        if _HAVE_ASCON:
            # Use ASCON-Hash (32-byte output, truncate to 16)
            hash_output = ascon.hash(input_data, variant="Ascon-Hash")
            key = hash_output[: self.KEY_SIZE]
        else:
            # Fallback to SHA-256 for development/testing
            hash_output = hashlib.sha256(input_data).digest()
            key = hash_output[: self.KEY_SIZE]

        self._key_cache[device_id] = key
        return key

    def clear_cache(self) -> None:
        """Clear the key cache.

        Useful for testing or when rotating keys.
        """
        self._key_cache.clear()
