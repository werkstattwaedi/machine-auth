// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/device_secrets/device_secrets_eeprom.h"

#include <algorithm>
#include <cstring>

#include "device_secrets.pb.h"
#include "pb_decode.h"
#include "pb_encode.h"
#include "pw_bytes/span.h"
#include "pw_checksum/crc32.h"
#include "pw_log/log.h"

// Device OS HAL - only included for P2 target
#if defined(__arm__)
extern "C" {
#include "eeprom_hal.h"
}
#endif

namespace maco::secrets {

namespace {

// Default EEPROM functions using Device OS HAL
void HalEepromGet([[maybe_unused]] uint32_t index,
                  void* data,
                  size_t length) {
#if defined(__arm__)
  HAL_EEPROM_Get(index, data, length);
#else
  // Host fallback - fill with 0xFF (unprogrammed EEPROM)
  std::memset(data, 0xFF, length);
#endif
}

void HalEepromPut(uint32_t index, const void* data, size_t length) {
#if defined(__arm__)
  HAL_EEPROM_Put(index, data, length);
#else
  // Host fallback - no-op
  (void)index;
  (void)data;
  (void)length;
#endif
}

}  // namespace

DeviceSecretsEeprom::DeviceSecretsEeprom()
    : eeprom_get_(HalEepromGet),
      eeprom_put_(HalEepromPut),
      eeprom_offset_(kDefaultEepromOffset) {}

DeviceSecretsEeprom::DeviceSecretsEeprom(EepromGetFn get_fn, EepromPutFn put_fn, size_t eeprom_offset)
    : eeprom_get_(std::move(get_fn)),
      eeprom_put_(std::move(put_fn)),
      eeprom_offset_(eeprom_offset) {}

DeviceSecretsEeprom::EepromGetFn DeviceSecretsEeprom::DefaultEepromGet() {
  return HalEepromGet;
}

DeviceSecretsEeprom::EepromPutFn DeviceSecretsEeprom::DefaultEepromPut() {
  return HalEepromPut;
}

bool DeviceSecretsEeprom::IsProvisioned() const {
  if (!loaded_) {
    LoadFromEeprom();
  }
  return valid_;
}

pw::Result<KeyBytes> DeviceSecretsEeprom::GetGatewayMasterSecret() const {
  if (!loaded_) {
    LoadFromEeprom();
  }
  if (!valid_) {
    return pw::Status::NotFound();
  }
  return KeyBytes::FromArray(gateway_master_secret_);
}

pw::Result<KeyBytes> DeviceSecretsEeprom::GetNtagTerminalKey() const {
  if (!loaded_) {
    LoadFromEeprom();
  }
  if (!valid_) {
    return pw::Status::NotFound();
  }
  return KeyBytes::FromArray(ntag_terminal_key_);
}

pw::Status DeviceSecretsEeprom::Provision(const KeyBytes& gateway_master_secret,
                                          const KeyBytes& ntag_terminal_key) {
  // Build proto message
  maco_secrets_DeviceSecretsStorage storage = maco_secrets_DeviceSecretsStorage_init_zero;

  // Copy gateway master secret (nanopb PB_BYTES_ARRAY_T has .size and .bytes[])
  storage.gateway_master_secret.size = KeyBytes::kSize;
  std::memcpy(storage.gateway_master_secret.bytes,
              gateway_master_secret.array().data(),
              KeyBytes::kSize);

  // Copy NTAG terminal key
  storage.ntag_terminal_key.size = KeyBytes::kSize;
  std::memcpy(storage.ntag_terminal_key.bytes,
              ntag_terminal_key.array().data(),
              KeyBytes::kSize);

  // Encode proto
  std::array<std::byte, kMaxProtoSize> proto_buffer{};
  pb_ostream_t stream = pb_ostream_from_buffer(
      reinterpret_cast<uint8_t*>(proto_buffer.data()), proto_buffer.size());

  if (!pb_encode(&stream, maco_secrets_DeviceSecretsStorage_fields, &storage)) {
    PW_LOG_ERROR("Failed to encode device secrets proto");
    return pw::Status::Internal();
  }

  const size_t proto_size = stream.bytes_written;

  // Build header
  Header header{};
  header.magic = kMagic;
  header.version = kVersion;
  header.length = static_cast<uint16_t>(proto_size);
  header.reserved = 0;

  // Compute CRC over header + proto
  const uint32_t crc = ComputeCrc(
      header, pw::span<const std::byte>(proto_buffer.data(), proto_size));

  // Write to EEPROM: header, proto, CRC
  eeprom_put_(eeprom_offset_, &header, sizeof(header));
  eeprom_put_(eeprom_offset_ + kHeaderSize, proto_buffer.data(), proto_size);
  eeprom_put_(eeprom_offset_ + kHeaderSize + proto_size, &crc, sizeof(crc));

  PW_LOG_INFO("Device secrets provisioned successfully");

  // Update cached state
  std::copy(gateway_master_secret.array().begin(),
            gateway_master_secret.array().end(),
            gateway_master_secret_.begin());
  std::copy(ntag_terminal_key.array().begin(),
            ntag_terminal_key.array().end(),
            ntag_terminal_key_.begin());
  loaded_ = true;
  valid_ = true;

  return pw::OkStatus();
}

void DeviceSecretsEeprom::Clear() {
  // Write invalid magic to mark as unprovisioned
  const uint32_t invalid_magic = 0xFFFFFFFF;
  eeprom_put_(eeprom_offset_, &invalid_magic, sizeof(invalid_magic));

  // Clear cached state
  gateway_master_secret_.fill(std::byte{0});
  ntag_terminal_key_.fill(std::byte{0});
  loaded_ = true;
  valid_ = false;

  PW_LOG_INFO("Device secrets cleared");
}

bool DeviceSecretsEeprom::LoadFromEeprom() const {
  loaded_ = true;
  valid_ = false;

  // Read header
  Header header{};
  eeprom_get_(eeprom_offset_, &header, sizeof(header));

  // Validate magic
  if (header.magic != kMagic) {
    PW_LOG_DEBUG("Device secrets: invalid magic 0x%08X (expected 0x%08X)",
                 static_cast<unsigned>(header.magic),
                 static_cast<unsigned>(kMagic));
    return false;
  }

  // Validate version
  if (header.version != kVersion) {
    PW_LOG_WARN("Device secrets: unsupported version %u (expected %u)",
                static_cast<unsigned>(header.version),
                static_cast<unsigned>(kVersion));
    return false;
  }

  // Validate length
  if (header.length > kMaxProtoSize) {
    PW_LOG_WARN("Device secrets: proto too large %u (max %zu)",
                static_cast<unsigned>(header.length), kMaxProtoSize);
    return false;
  }

  // Read proto data
  std::array<std::byte, kMaxProtoSize> proto_buffer{};
  eeprom_get_(eeprom_offset_ + kHeaderSize, proto_buffer.data(), header.length);

  // Read and verify CRC
  uint32_t stored_crc = 0;
  eeprom_get_(eeprom_offset_ + kHeaderSize + header.length, &stored_crc, sizeof(stored_crc));

  const uint32_t computed_crc = ComputeCrc(
      header, pw::span<const std::byte>(proto_buffer.data(), header.length));

  if (stored_crc != computed_crc) {
    PW_LOG_WARN("Device secrets: CRC mismatch (stored=0x%08X, computed=0x%08X)",
                static_cast<unsigned>(stored_crc),
                static_cast<unsigned>(computed_crc));
    return false;
  }

  // Decode proto
  maco_secrets_DeviceSecretsStorage storage = maco_secrets_DeviceSecretsStorage_init_zero;
  pb_istream_t stream = pb_istream_from_buffer(
      reinterpret_cast<const uint8_t*>(proto_buffer.data()), header.length);

  if (!pb_decode(&stream, maco_secrets_DeviceSecretsStorage_fields, &storage)) {
    PW_LOG_ERROR("Device secrets: failed to decode proto");
    return false;
  }

  // Copy to cached state (nanopb PB_BYTES_ARRAY_T has .size and .bytes[])
  std::memcpy(gateway_master_secret_.data(),
              storage.gateway_master_secret.bytes,
              KeyBytes::kSize);
  std::memcpy(ntag_terminal_key_.data(),
              storage.ntag_terminal_key.bytes,
              KeyBytes::kSize);

  valid_ = true;
  PW_LOG_INFO("Device secrets loaded from EEPROM");
  return true;
}

uint32_t DeviceSecretsEeprom::ComputeCrc(const Header& header,
                                          pw::span<const std::byte> proto_data) const {
  pw::checksum::Crc32 crc;
  crc.Update(pw::as_bytes(pw::span(&header, 1)));
  crc.Update(proto_data);
  return crc.value();
}

}  // namespace maco::secrets
