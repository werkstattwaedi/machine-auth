#!/usr/bin/env python3
"""Calculate and patch SHA256/CRC32 into Particle firmware binary.

Particle firmware binaries have a suffix structure at the end:
- SHA256 hash (32 bytes) of everything before the suffix
- suffix_size (2 bytes)
- CRC32 (4 bytes) of everything before the CRC

Total suffix/CRC block length: 38 bytes

This script patches the placeholder values with calculated checksums.
"""
import binascii
import hashlib
import struct
import sys

CRC_BLOCK_LEN = 38  # SHA256 (32) + suffix_size (2) + CRC (4)
CRC_LEN = 4


def crc32(data: bytes) -> int:
    """Calculate CRC32 matching Particle's implementation."""
    return binascii.crc32(data) & 0xFFFFFFFF


def patch_firmware(bin_path: str) -> None:
    """Patch SHA256 and CRC32 into firmware binary."""
    with open(bin_path, 'r+b') as f:
        data = f.read()
        size = len(data)

        if size < CRC_BLOCK_LEN:
            raise ValueError(f"Binary too small: {size} bytes (need at least {CRC_BLOCK_LEN})")

        # Verify placeholder pattern (optional check)
        suffix_block = data[-CRC_BLOCK_LEN:]
        expected_sha_placeholder = bytes(range(1, 33))  # 01 02 03 ... 20
        expected_crc_placeholder = b'\x78\x56\x34\x12'  # 0x12345678 little-endian

        if suffix_block[:32] != expected_sha_placeholder:
            print(f"Warning: SHA256 placeholder not found at expected location", file=sys.stderr)
        if suffix_block[-4:] != expected_crc_placeholder:
            print(f"Warning: CRC placeholder not found at expected location", file=sys.stderr)

        # Calculate SHA256 of everything except last 38 bytes
        sha256_hash = hashlib.sha256(data[:size - CRC_BLOCK_LEN]).digest()

        # Patch SHA256 at offset -38
        f.seek(size - CRC_BLOCK_LEN)
        f.write(sha256_hash)

        # Re-read with SHA256 patched
        f.seek(0)
        data = f.read()

        # Calculate CRC32 of everything except last 4 bytes
        crc = crc32(data[:size - CRC_LEN])

        # Patch CRC at offset -4 (big-endian, as Particle expects)
        f.seek(size - CRC_LEN)
        f.write(struct.pack('>I', crc))

        print(f"Patched {bin_path}:")
        print(f"  SHA256: {sha256_hash.hex()}")
        print(f"  CRC32:  0x{crc:08x}")


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <firmware.bin>", file=sys.stderr)
        return 1

    try:
        patch_firmware(sys.argv[1])
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
