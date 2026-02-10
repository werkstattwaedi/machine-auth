// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/gateway/derive_ascon_key.h"

#include "pb_crypto/pb_crypto.h"
#include "pw_assert/check.h"

namespace maco::gateway {

std::array<std::byte, 16> DeriveAsconKey(pw::ConstByteSpan master_secret,
                                         const DeviceId& device_id) {
  // Concatenate master_secret || device_id
  std::array<std::byte, 16 + DeviceId::kSize> key_material;
  PW_CHECK_INT_EQ(master_secret.size(), 16u, "Master secret must be 16 bytes");
  std::copy(master_secret.begin(), master_secret.end(), key_material.begin());
  auto id_bytes = device_id.bytes();
  std::copy(id_bytes.begin(), id_bytes.end(), key_material.begin() + 16);

  // Hash and truncate to 16 bytes
  std::array<std::byte, pb::crypto::kAsconHashSize> hash;
  auto status = pb::crypto::AsconHash256(key_material, hash);
  PW_CHECK_OK(status, "Key derivation failed");

  std::array<std::byte, 16> key;
  std::copy(hash.begin(), hash.begin() + key.size(), key.begin());
  return key;
}

}  // namespace maco::gateway
