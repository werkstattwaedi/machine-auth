// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/// @file pb_crypto_ascon.cc
/// @brief ASCON implementation using the portable reference library.

#include "pb_crypto/pb_crypto.h"

#include <cstring>

#include "ascon.h"

namespace pb::crypto {

pw::Status AsconAead128Encrypt(pw::ConstByteSpan key,
                               pw::ConstByteSpan nonce,
                               pw::ConstByteSpan associated_data,
                               pw::ConstByteSpan plaintext,
                               pw::ByteSpan ciphertext,
                               pw::ByteSpan tag) {
  if (key.size() != kAsconKeySize) {
    return pw::Status::InvalidArgument();
  }
  if (nonce.size() != kAsconNonceSize) {
    return pw::Status::InvalidArgument();
  }
  if (ciphertext.size() < plaintext.size()) {
    return pw::Status::ResourceExhausted();
  }
  if (tag.size() < kAsconTagSize) {
    return pw::Status::ResourceExhausted();
  }

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* key_ptr = reinterpret_cast<const uint8_t*>(key.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* nonce_ptr = reinterpret_cast<const uint8_t*>(nonce.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* ad_ptr = reinterpret_cast<const uint8_t*>(associated_data.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* pt_ptr = reinterpret_cast<const uint8_t*>(plaintext.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* ct_ptr = reinterpret_cast<uint8_t*>(ciphertext.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* tag_ptr = reinterpret_cast<uint8_t*>(tag.data());

  ascon_aead128_encrypt(ct_ptr,
                        tag_ptr,
                        key_ptr,
                        nonce_ptr,
                        ad_ptr,
                        associated_data.size(),
                        pt_ptr,
                        plaintext.size());

  return pw::OkStatus();
}

pw::Status AsconAead128Decrypt(pw::ConstByteSpan key,
                               pw::ConstByteSpan nonce,
                               pw::ConstByteSpan associated_data,
                               pw::ConstByteSpan ciphertext,
                               pw::ConstByteSpan tag,
                               pw::ByteSpan plaintext) {
  if (key.size() != kAsconKeySize) {
    return pw::Status::InvalidArgument();
  }
  if (nonce.size() != kAsconNonceSize) {
    return pw::Status::InvalidArgument();
  }
  if (tag.size() != kAsconTagSize) {
    return pw::Status::InvalidArgument();
  }
  if (plaintext.size() < ciphertext.size()) {
    return pw::Status::ResourceExhausted();
  }

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* key_ptr = reinterpret_cast<const uint8_t*>(key.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* nonce_ptr = reinterpret_cast<const uint8_t*>(nonce.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* ad_ptr = reinterpret_cast<const uint8_t*>(associated_data.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* ct_ptr = reinterpret_cast<const uint8_t*>(ciphertext.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* tag_ptr = reinterpret_cast<const uint8_t*>(tag.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* pt_ptr = reinterpret_cast<uint8_t*>(plaintext.data());

  int result = ascon_aead128_decrypt(pt_ptr,
                                     key_ptr,
                                     nonce_ptr,
                                     ad_ptr,
                                     associated_data.size(),
                                     ct_ptr,
                                     ciphertext.size(),
                                     tag_ptr);

  if (result != 0) {
    return pw::Status::Unauthenticated();
  }

  return pw::OkStatus();
}

pw::Status AsconHash256(pw::ConstByteSpan message, pw::ByteSpan hash) {
  if (hash.size() < kAsconHashSize) {
    return pw::Status::ResourceExhausted();
  }

  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  const auto* msg_ptr = reinterpret_cast<const uint8_t*>(message.data());
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* hash_ptr = reinterpret_cast<uint8_t*>(hash.data());

  ascon_hash256(hash_ptr, msg_ptr, message.size());

  return pw::OkStatus();
}

}  // namespace pb::crypto
