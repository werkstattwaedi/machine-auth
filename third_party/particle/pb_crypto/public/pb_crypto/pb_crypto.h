// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file pb_crypto.h
/// @brief Cryptographic operations for authentication and secure communication.
///
/// This module provides:
/// - AES-128-CBC and AES-CMAC for NTAG424 authentication (platform-specific)
/// - ASCON-AEAD128 and ASCON-Hash256 for gateway communication (portable)
///
/// AES backends:
/// - Particle P2: Uses Device OS mbedTLS (potentially HW accelerated)
/// - Host: Uses mbedTLS directly
///
/// ASCON uses the portable reference implementation on all platforms.
///
/// Usage:
/// @code
/// #include "pb_crypto/pb_crypto.h"
///
/// // AES for NTAG424
/// std::array<std::byte, 16> key = {...};
/// std::array<std::byte, 16> iv = {};
/// std::array<std::byte, 32> plaintext = {...};
/// std::array<std::byte, 32> ciphertext;
/// PW_TRY(pb::crypto::AesCbcEncrypt(key, iv, plaintext, ciphertext));
///
/// // ASCON for gateway communication
/// std::array<std::byte, 16> ascon_key = {...};
/// std::array<std::byte, 16> nonce = {...};
/// std::array<std::byte, 16> tag;
/// PW_TRY(pb::crypto::AsconAead128Encrypt(ascon_key, nonce, {}, plaintext,
///                                         ciphertext, tag));
/// @endcode

#include <array>
#include <cstddef>

#include "pw_bytes/span.h"
#include "pw_status/status.h"

namespace pb::crypto {

/// AES block size in bytes (128 bits).
inline constexpr size_t kAesBlockSize = 16;

/// AES-128 key size in bytes.
inline constexpr size_t kAesKeySize = 16;

/// AES-128-CBC encryption.
///
/// @param key 16-byte AES key
/// @param iv 16-byte initialization vector (not modified)
/// @param plaintext Input data (must be multiple of 16 bytes)
/// @param ciphertext Output buffer (same size as plaintext)
/// @return OkStatus on success, InvalidArgument for wrong sizes,
///         Internal for crypto errors
pw::Status AesCbcEncrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan plaintext,
                         pw::ByteSpan ciphertext);

/// AES-128-CBC decryption.
///
/// @param key 16-byte AES key
/// @param iv 16-byte initialization vector (not modified)
/// @param ciphertext Input data (must be multiple of 16 bytes)
/// @param plaintext Output buffer (same size as ciphertext)
/// @return OkStatus on success, InvalidArgument for wrong sizes,
///         Internal for crypto errors
pw::Status AesCbcDecrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan ciphertext,
                         pw::ByteSpan plaintext);

/// AES-CMAC (Cipher-based Message Authentication Code).
///
/// Computes a 16-byte MAC over the input data using AES-128.
///
/// @param key 16-byte AES key
/// @param data Input data (any length)
/// @param mac Output MAC (must be at least 16 bytes)
/// @return OkStatus on success, InvalidArgument for wrong key size,
///         ResourceExhausted if mac too small, Internal for crypto errors
pw::Status AesCmac(pw::ConstByteSpan key,
                   pw::ConstByteSpan data,
                   pw::ByteSpan mac);

// ============================================================================
// ASCON Lightweight Cryptography (NIST LWC Standard)
// ============================================================================

/// ASCON-AEAD128 key size in bytes.
inline constexpr size_t kAsconKeySize = 16;

/// ASCON-AEAD128 nonce size in bytes.
inline constexpr size_t kAsconNonceSize = 16;

/// ASCON-AEAD128 authentication tag size in bytes.
inline constexpr size_t kAsconTagSize = 16;

/// ASCON-Hash256 output size in bytes.
inline constexpr size_t kAsconHashSize = 32;

/// ASCON-AEAD128 authenticated encryption.
///
/// Encrypts plaintext and computes an authentication tag over both the
/// ciphertext and associated data. The nonce MUST be unique for each
/// encryption with the same key.
///
/// @param key 16-byte secret key
/// @param nonce 16-byte nonce (MUST be unique per encryption)
/// @param associated_data Data to authenticate but not encrypt (can be empty)
/// @param plaintext Data to encrypt
/// @param ciphertext Output buffer (same size as plaintext)
/// @param tag Output authentication tag (16 bytes)
/// @return OkStatus on success, InvalidArgument for wrong sizes
pw::Status AsconAead128Encrypt(pw::ConstByteSpan key,
                               pw::ConstByteSpan nonce,
                               pw::ConstByteSpan associated_data,
                               pw::ConstByteSpan plaintext,
                               pw::ByteSpan ciphertext,
                               pw::ByteSpan tag);

/// ASCON-AEAD128 authenticated decryption.
///
/// Decrypts ciphertext and verifies the authentication tag. If verification
/// fails, the plaintext buffer is zeroed and an error is returned.
///
/// @param key 16-byte secret key
/// @param nonce 16-byte nonce (must match encryption)
/// @param associated_data Associated data (must match encryption)
/// @param ciphertext Data to decrypt
/// @param tag Authentication tag to verify (16 bytes)
/// @param plaintext Output buffer (same size as ciphertext)
/// @return OkStatus on success, Unauthenticated if tag verification fails,
///         InvalidArgument for wrong sizes
pw::Status AsconAead128Decrypt(pw::ConstByteSpan key,
                               pw::ConstByteSpan nonce,
                               pw::ConstByteSpan associated_data,
                               pw::ConstByteSpan ciphertext,
                               pw::ConstByteSpan tag,
                               pw::ByteSpan plaintext);

/// ASCON-Hash256 cryptographic hash.
///
/// Computes a 256-bit hash of the input message.
///
/// @param message Input data (any length)
/// @param hash Output hash (32 bytes)
/// @return OkStatus on success, ResourceExhausted if hash buffer too small
pw::Status AsconHash256(pw::ConstByteSpan message, pw::ByteSpan hash);

}  // namespace pb::crypto
