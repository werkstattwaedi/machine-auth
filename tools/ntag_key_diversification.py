# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""AES-128 CMAC-based key diversification for NTAG 424 DNA tags.

Port of functions/src/ntag/key_diversification.ts.
Based on NXP Application Note AN10922.
"""

from Crypto.Cipher import AES

# Diversification constants per key slot
KEY_IDS: dict[str, bytes] = {
    "application": b"\x00\x00\x01",
    "terminal": b"\x00\x00\x02",
    "authorization": b"\x00\x00\x03",
    "reserved1": b"\x00\x00\x04",
    "reserved2": b"\x00\x00\x05",
}

_Rb = b"\x00" * 15 + b"\x87"


def _aes_ecb_encrypt_block(key: bytes, block: bytes) -> bytes:
    return AES.new(key, AES.MODE_ECB).encrypt(block)


def _aes_cbc_encrypt(key: bytes, data: bytes) -> bytes:
    cipher = AES.new(key, AES.MODE_CBC, iv=b"\x00" * 16)
    return cipher.encrypt(data)


def _left_shift(data: bytes) -> bytearray:
    out = bytearray(16)
    for i in range(15):
        out[i] = ((data[i] << 1) | (data[i + 1] >> 7)) & 0xFF
    out[15] = (data[15] << 1) & 0xFF
    return out


def _generate_subkeys(master_key: bytes) -> tuple[bytes, bytes]:
    k0 = _aes_ecb_encrypt_block(master_key, b"\x00" * 16)

    k1 = _left_shift(k0)
    if k0[0] & 0x80:
        for i in range(16):
            k1[i] ^= _Rb[i]

    k2 = _left_shift(k1)
    if k1[0] & 0x80:
        for i in range(16):
            k2[i] ^= _Rb[i]

    return bytes(k1), bytes(k2)


def diversify_key(
    master_key: bytes,
    system_name: str,
    tag_uid: bytes,
    key_name: str,
) -> bytes:
    """Compute a single diversified key.

    Args:
        master_key: 16-byte AES-128 master key.
        system_name: System identifier string (e.g. "OwwMachineAuth").
        tag_uid: 7-byte tag UID.
        key_name: One of "application", "terminal", "authorization",
                  "reserved1", "reserved2".

    Returns:
        16-byte diversified key.
    """
    assert len(master_key) == 16
    assert len(tag_uid) == 7
    key_id = KEY_IDS[key_name]

    k1, k2 = _generate_subkeys(master_key)

    div_input = tag_uid + key_id + system_name.encode("utf-8")
    max_len = 31
    pad_len = max_len - len(div_input)
    padding = bytes([0x80] + [0x00] * (pad_len - 1)) if pad_len > 0 else b""
    has_padding = pad_len > 0

    cmac_input = bytearray(b"\x01" + div_input + padding)
    assert len(cmac_input) == 32

    k = k2 if has_padding else k1
    for i in range(16):
        cmac_input[16 + i] ^= k[i]

    encrypted = _aes_cbc_encrypt(master_key, bytes(cmac_input))
    return encrypted[16:32]


def diversify_keys(
    master_key: bytes,
    system_name: str,
    tag_uid: bytes,
) -> dict[str, bytes]:
    """Compute all diversified keys for a tag.

    Returns:
        Dict mapping key name to 16-byte diversified key.
    """
    return {
        name: diversify_key(master_key, system_name, tag_uid, name)
        for name in KEY_IDS
    }
