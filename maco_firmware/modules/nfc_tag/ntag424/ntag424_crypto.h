// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "pw_bytes/span.h"
#include "pw_status/status.h"

namespace maco::nfc {

/// AES-128-CBC encryption.
/// Input must be a multiple of 16 bytes.
/// @param key 16-byte AES key
/// @param iv 16-byte initialization vector
/// @param plaintext Input data (multiple of 16 bytes)
/// @param ciphertext Output buffer (same size as plaintext)
pw::Status AesCbcEncrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan plaintext,
                         pw::ByteSpan ciphertext);

/// AES-128-CBC decryption.
/// Input must be a multiple of 16 bytes.
/// @param key 16-byte AES key
/// @param iv 16-byte initialization vector
/// @param ciphertext Input data (multiple of 16 bytes)
/// @param plaintext Output buffer (same size as ciphertext)
pw::Status AesCbcDecrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan ciphertext,
                         pw::ByteSpan plaintext);

/// Compute AES-CMAC of data.
/// @param key 16-byte AES key
/// @param data Input data
/// @param mac Output MAC (16 bytes)
pw::Status AesCmac(pw::ConstByteSpan key,
                   pw::ConstByteSpan data,
                   pw::ByteSpan mac);

/// Calculate SV1 vector for session encryption key derivation.
/// SV1 = 0xA5 0x5A || 0x00 0x01 0x00 0x80 || RndA[15:14] ||
///       (RndA[13:8] XOR RndB[15:10]) || RndB[9:0] || RndA[7:0]
/// @param rnd_a Terminal's 16-byte random (RndA)
/// @param rnd_b Tag's 16-byte random (RndB, after decryption)
/// @param sv1 Output 32-byte SV1 vector
void CalculateSV1(pw::ConstByteSpan rnd_a,
                  pw::ConstByteSpan rnd_b,
                  pw::ByteSpan sv1);

/// Calculate SV2 vector for session MAC key derivation.
/// Same structure as SV1 but with prefix 0x5A 0xA5.
/// @param rnd_a Terminal's 16-byte random (RndA)
/// @param rnd_b Tag's 16-byte random (RndB, after decryption)
/// @param sv2 Output 32-byte SV2 vector
void CalculateSV2(pw::ConstByteSpan rnd_a,
                  pw::ConstByteSpan rnd_b,
                  pw::ByteSpan sv2);

/// Derive session authentication keys from RndA, RndB, and auth key.
/// @param auth_key 16-byte authentication key (K0-K4)
/// @param rnd_a Terminal's 16-byte random
/// @param rnd_b Tag's 16-byte random (decrypted)
/// @param ses_auth_enc_key Output 16-byte session encryption key
/// @param ses_auth_mac_key Output 16-byte session MAC key
pw::Status DeriveSessionKeys(pw::ConstByteSpan auth_key,
                             pw::ConstByteSpan rnd_a,
                             pw::ConstByteSpan rnd_b,
                             pw::ByteSpan ses_auth_enc_key,
                             pw::ByteSpan ses_auth_mac_key);

/// Rotate byte array left by 1 byte.
/// Used for RndB' = RndB rotated left by 1.
/// @param input Input buffer
/// @param output Output buffer (can be same as input)
void RotateLeft1(pw::ConstByteSpan input, pw::ByteSpan output);

/// Verify RndA' matches expected RndA rotated left by 1.
/// @param rnd_a Original RndA sent by terminal
/// @param rnd_a_prime RndA' received from tag
/// @return true if RndA' == rotate_left(RndA, 1)
bool VerifyRndAPrime(pw::ConstByteSpan rnd_a, pw::ConstByteSpan rnd_a_prime);

// ============================================================================
// ChangeKey Support Functions
// ============================================================================

/// Calculate CRC32 for NTAG424 ChangeKey command (CRC32NK).
///
/// NTAG424 uses JAMCRC (CRC-32 without final inversion):
/// - Polynomial: 0x04C11DB7
/// - Initial value: 0xFFFFFFFF
/// - Final XOR: 0x00000000 (no inversion)
/// - Bit order: LSB first (reflected)
///
/// Used in ChangeKey for non-zero key numbers:
/// CRC32NK is computed over (NewKey || KeyVersion).
///
/// @param data Input data
/// @param crc_out 4-byte output buffer (little-endian)
void CalculateCRC32NK(pw::ConstByteSpan data, pw::ByteSpan crc_out);

/// XOR two equal-length byte arrays.
/// Used for ChangeKey when changing non-zero keys: NewKey XOR OldKey.
///
/// @param a First input
/// @param b Second input
/// @param result Output buffer (same size as inputs)
/// @return OkStatus on success, InvalidArgument if sizes don't match
pw::Status XorBytes(pw::ConstByteSpan a,
                    pw::ConstByteSpan b,
                    pw::ByteSpan result);

// ============================================================================
// Security Utilities
// ============================================================================

/// Securely zero memory to prevent sensitive data leakage.
///
/// Uses volatile writes to prevent compiler optimization from removing
/// the zeroing. Call this after sensitive data (keys, nonces) is no
/// longer needed.
///
/// @param data Buffer to zero
void SecureZero(pw::ByteSpan data);

/// Template overload for std::array.
template <size_t N>
void SecureZero(std::array<std::byte, N>& data) {
  SecureZero(pw::ByteSpan(data));
}

}  // namespace maco::nfc
