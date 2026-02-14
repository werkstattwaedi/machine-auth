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

// Device OS HAL - raw flash storage bypasses LittleFS FsLock.
// PARTICLE_USE_UNSTABLE_API exposes hal_storage_* declarations
// that are otherwise hidden from user modules.
#if defined(__arm__)
#define PARTICLE_USE_UNSTABLE_API
#include "storage_hal.h"
#endif

namespace maco::secrets {

namespace {

// Default flash storage functions using hal_storage API.
// These bypass LittleFS entirely, avoiding the FsLock deadlock
// with Device OS system thread.
int HalStorageRead([[maybe_unused]] uintptr_t addr,
                   uint8_t* data,
                   size_t length) {
#if defined(__arm__)
  return hal_storage_read(HAL_STORAGE_ID_EXTERNAL_FLASH, addr, data, length);
#else
  // Host fallback - fill with 0xFF (erased flash)
  std::memset(data, 0xFF, length);
  return static_cast<int>(length);
#endif
}

int HalStorageWrite([[maybe_unused]] uintptr_t addr,
                    [[maybe_unused]] const uint8_t* data,
                    [[maybe_unused]] size_t length) {
#if defined(__arm__)
  return hal_storage_write(HAL_STORAGE_ID_EXTERNAL_FLASH, addr, data, length);
#else
  // Host fallback - no-op
  return static_cast<int>(length);
#endif
}

int HalStorageErase([[maybe_unused]] uintptr_t addr,
                    [[maybe_unused]] size_t length) {
#if defined(__arm__)
  return hal_storage_erase(HAL_STORAGE_ID_EXTERNAL_FLASH, addr, length);
#else
  // Host fallback - no-op
  return 0;
#endif
}

}  // namespace

DeviceSecretsEeprom::DeviceSecretsEeprom()
    : read_fn_(HalStorageRead),
      write_fn_(HalStorageWrite),
      erase_fn_(HalStorageErase),
      flash_address_(kDefaultFlashAddress) {}

DeviceSecretsEeprom::DeviceSecretsEeprom(ReadFn read_fn, WriteFn write_fn,
                                          EraseFn erase_fn,
                                          uintptr_t flash_address)
    : read_fn_(std::move(read_fn)),
      write_fn_(std::move(write_fn)),
      erase_fn_(std::move(erase_fn)),
      flash_address_(flash_address) {}

bool DeviceSecretsEeprom::IsProvisioned() const {
  if (!loaded_) {
    LoadFromFlash();
  }
  return valid_;
}

pw::Result<KeyBytes> DeviceSecretsEeprom::GetGatewayMasterSecret() const {
  if (!loaded_) {
    LoadFromFlash();
  }
  if (!valid_) {
    return pw::Status::NotFound();
  }
  return KeyBytes::FromArray(gateway_master_secret_);
}

pw::Result<KeyBytes> DeviceSecretsEeprom::GetNtagTerminalKey() const {
  if (!loaded_) {
    LoadFromFlash();
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

  // Encode proto into a contiguous buffer: [header | proto | crc]
  std::array<uint8_t, kMaxTotalSize> write_buffer{};
  size_t write_pos = 0;

  // Encode proto portion first (need size for header)
  std::array<uint8_t, kMaxProtoSize> proto_buffer{};
  pb_ostream_t stream = pb_ostream_from_buffer(proto_buffer.data(),
                                                proto_buffer.size());

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
      header, pw::span<const std::byte>(
          reinterpret_cast<const std::byte*>(proto_buffer.data()), proto_size));

  // Assemble into single contiguous buffer
  std::memcpy(&write_buffer[write_pos], &header, sizeof(header));
  write_pos += sizeof(header);
  std::memcpy(&write_buffer[write_pos], proto_buffer.data(), proto_size);
  write_pos += proto_size;
  std::memcpy(&write_buffer[write_pos], &crc, sizeof(crc));
  write_pos += sizeof(crc);

  // Erase flash sector (required before writing - flash can only go 1→0)
  int result = erase_fn_(flash_address_, kSectorSize);
  if (result < 0) {
    PW_LOG_ERROR("Flash erase failed: %d", result);
    loaded_ = false;
    valid_ = false;
    return pw::Status::Internal();
  }

  // Write all data in a single flash operation
  result = write_fn_(flash_address_, write_buffer.data(), write_pos);
  if (result < 0) {
    PW_LOG_ERROR("Flash write failed: %d", result);
    loaded_ = false;
    valid_ = false;
    return pw::Status::Internal();
  }

  PW_LOG_INFO("Device secrets provisioned successfully (%zu bytes at 0x%X)",
              write_pos, static_cast<unsigned>(flash_address_));

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
  // Erase the flash sector (all 0xFF = invalid magic)
  int result = erase_fn_(flash_address_, kSectorSize);
  if (result < 0) {
    PW_LOG_ERROR("Flash erase failed during Clear: %d", result);
  }

  // Clear cached state
  gateway_master_secret_.fill(std::byte{0});
  ntag_terminal_key_.fill(std::byte{0});
  loaded_ = true;
  valid_ = false;

  PW_LOG_INFO("Device secrets cleared");
}

bool DeviceSecretsEeprom::LoadFromFlash() const {
  loaded_ = true;
  valid_ = false;

  // Read header
  Header header{};
  int result = read_fn_(flash_address_,
                         reinterpret_cast<uint8_t*>(&header), sizeof(header));
  if (result < 0) {
    PW_LOG_DEBUG("Device secrets: flash read failed: %d", result);
    return false;
  }

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
  std::array<uint8_t, kMaxProtoSize> proto_buffer{};
  result = read_fn_(flash_address_ + kHeaderSize,
                     proto_buffer.data(), header.length);
  if (result < 0) {
    PW_LOG_WARN("Device secrets: flash read failed for proto: %d", result);
    return false;
  }

  // Read and verify CRC
  uint32_t stored_crc = 0;
  result = read_fn_(flash_address_ + kHeaderSize + header.length,
                     reinterpret_cast<uint8_t*>(&stored_crc), sizeof(stored_crc));
  if (result < 0) {
    PW_LOG_WARN("Device secrets: flash read failed for CRC: %d", result);
    return false;
  }

  const uint32_t computed_crc = ComputeCrc(
      header, pw::span<const std::byte>(
          reinterpret_cast<const std::byte*>(proto_buffer.data()),
          header.length));

  if (stored_crc != computed_crc) {
    PW_LOG_WARN("Device secrets: CRC mismatch (stored=0x%08X, computed=0x%08X)",
                static_cast<unsigned>(stored_crc),
                static_cast<unsigned>(computed_crc));
    return false;
  }

  // Decode proto
  maco_secrets_DeviceSecretsStorage storage = maco_secrets_DeviceSecretsStorage_init_zero;
  pb_istream_t istream = pb_istream_from_buffer(proto_buffer.data(),
                                                 header.length);

  if (!pb_decode(&istream, maco_secrets_DeviceSecretsStorage_fields, &storage)) {
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
  PW_LOG_INFO("Device secrets loaded from flash (0x%X)",
              static_cast<unsigned>(flash_address_));
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
