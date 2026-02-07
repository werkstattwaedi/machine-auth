// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file pb_crypto_particle.cc
/// @brief Particle Device OS backend for pb_crypto.
///
/// Uses mbedtls_embedded library built from Device OS's mbedTLS sources.
/// This provides AES-CBC and AES-CMAC for NTAG424 authentication.

#include "pb_crypto/pb_crypto.h"

#include <algorithm>
#include <array>

#include "mbedtls/aes.h"
#include "mbedtls/cmac.h"

namespace pb::crypto {

namespace {

constexpr size_t kBitsPerByte = 8;

}  // namespace

pw::Status AesCbcEncrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan plaintext,
                         pw::ByteSpan ciphertext) {
  if (key.size() != kAesKeySize) {
    return pw::Status::InvalidArgument();
  }
  if (iv.size() != kAesBlockSize) {
    return pw::Status::InvalidArgument();
  }
  if (plaintext.size() % kAesBlockSize != 0) {
    return pw::Status::InvalidArgument();
  }
  if (ciphertext.size() < plaintext.size()) {
    return pw::Status::ResourceExhausted();
  }

  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* key_data = reinterpret_cast<const unsigned char*>(key.data());
  if (mbedtls_aes_setkey_enc(&aes, key_data, kAesKeySize * kBitsPerByte) != 0) {
    mbedtls_aes_free(&aes);
    return pw::Status::Internal();
  }

  // mbedtls_aes_crypt_cbc modifies IV in place, so make a copy
  std::array<unsigned char, kAesBlockSize> iv_copy;
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  std::copy(reinterpret_cast<const unsigned char*>(iv.data()),
            // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
            reinterpret_cast<const unsigned char*>(iv.data()) + kAesBlockSize,
            iv_copy.begin());

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* in = reinterpret_cast<const unsigned char*>(plaintext.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* out = reinterpret_cast<unsigned char*>(ciphertext.data());

  if (mbedtls_aes_crypt_cbc(&aes,
                            MBEDTLS_AES_ENCRYPT,
                            plaintext.size(),
                            iv_copy.data(),
                            in,
                            out) != 0) {
    mbedtls_aes_free(&aes);
    return pw::Status::Internal();
  }

  mbedtls_aes_free(&aes);
  return pw::OkStatus();
}

pw::Status AesCbcDecrypt(pw::ConstByteSpan key,
                         pw::ConstByteSpan iv,
                         pw::ConstByteSpan ciphertext,
                         pw::ByteSpan plaintext) {
  if (key.size() != kAesKeySize) {
    return pw::Status::InvalidArgument();
  }
  if (iv.size() != kAesBlockSize) {
    return pw::Status::InvalidArgument();
  }
  if (ciphertext.size() % kAesBlockSize != 0) {
    return pw::Status::InvalidArgument();
  }
  if (plaintext.size() < ciphertext.size()) {
    return pw::Status::ResourceExhausted();
  }

  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* key_data = reinterpret_cast<const unsigned char*>(key.data());
  if (mbedtls_aes_setkey_dec(&aes, key_data, kAesKeySize * kBitsPerByte) != 0) {
    mbedtls_aes_free(&aes);
    return pw::Status::Internal();
  }

  // mbedtls_aes_crypt_cbc modifies IV in place, so make a copy
  std::array<unsigned char, kAesBlockSize> iv_copy;
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  std::copy(reinterpret_cast<const unsigned char*>(iv.data()),
            // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
            reinterpret_cast<const unsigned char*>(iv.data()) + kAesBlockSize,
            iv_copy.begin());

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* in = reinterpret_cast<const unsigned char*>(ciphertext.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* out = reinterpret_cast<unsigned char*>(plaintext.data());

  if (mbedtls_aes_crypt_cbc(&aes,
                            MBEDTLS_AES_DECRYPT,
                            ciphertext.size(),
                            iv_copy.data(),
                            in,
                            out) != 0) {
    mbedtls_aes_free(&aes);
    return pw::Status::Internal();
  }

  mbedtls_aes_free(&aes);
  return pw::OkStatus();
}

pw::Status AesCmac(pw::ConstByteSpan key,
                   pw::ConstByteSpan data,
                   pw::ByteSpan mac) {
  if (key.size() != kAesKeySize) {
    return pw::Status::InvalidArgument();
  }
  if (mac.size() < kAesBlockSize) {
    return pw::Status::ResourceExhausted();
  }

  const mbedtls_cipher_info_t* cipher_info =
      mbedtls_cipher_info_from_type(MBEDTLS_CIPHER_AES_128_ECB);
  if (cipher_info == nullptr) {
    return pw::Status::Internal();
  }

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* key_data = reinterpret_cast<const unsigned char*>(key.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* data_ptr = reinterpret_cast<const unsigned char*>(data.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* mac_ptr = reinterpret_cast<unsigned char*>(mac.data());

  if (mbedtls_cipher_cmac(cipher_info,
                          key_data,
                          kAesKeySize * kBitsPerByte,
                          data_ptr,
                          data.size(),
                          mac_ptr) != 0) {
    return pw::Status::Internal();
  }

  return pw::OkStatus();
}

}  // namespace pb::crypto
