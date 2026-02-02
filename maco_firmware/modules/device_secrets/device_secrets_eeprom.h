// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file device_secrets_eeprom.h
/// @brief EEPROM-backed implementation of DeviceSecrets for P2.
///
/// Storage format:
/// @code
/// ┌─────────────────────────────────────────────┐
/// │ Offset 0x00: Magic (4 bytes) = "MAC0"       │
/// │ Offset 0x04: Version (1 byte) = 0x01        │
/// │ Offset 0x05: Length (2 bytes, little-endian)│
/// │ Offset 0x07: Reserved (1 byte)              │
/// │ Offset 0x08: Nanopb-encoded proto           │
/// │ After proto: CRC32 (4 bytes)                │
/// └─────────────────────────────────────────────┘
/// @endcode
///
/// The proto is encoded using nanopb and includes:
/// - gateway_master_secret (16 bytes)
/// - ntag_terminal_key (16 bytes)

#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>

#include "device_secrets/device_secrets.h"
#include "maco_firmware/types.h"
#include "pw_result/result.h"
#include "pw_span/span.h"
#include "pw_status/status.h"

namespace maco::secrets {

/// EEPROM-backed device secrets storage.
///
/// This implementation reads/writes secrets to EEPROM using the Device OS
/// HAL. Secrets are validated on read using CRC32 and magic bytes.
///
/// Thread safety: All public methods are thread-safe (EEPROM HAL is
/// internally synchronized).
class DeviceSecretsEeprom : public DeviceSecrets {
 public:
  /// Storage format constants.
  static constexpr uint32_t kMagic = 0x3043414D;  // "MAC0" in little-endian
  static constexpr uint8_t kVersion = 0x01;
  static constexpr size_t kHeaderSize = 8;  // Magic(4) + Version(1) + Length(2) + Reserved(1)
  static constexpr size_t kMaxProtoSize = 64;  // More than enough for 2x16 byte keys
  static constexpr size_t kCrcSize = 4;
  static constexpr size_t kMaxTotalSize = kHeaderSize + kMaxProtoSize + kCrcSize;

  /// EEPROM storage offset (configurable for testing).
  static constexpr size_t kDefaultEepromOffset = 0;

  /// Type for EEPROM read/write functions (for testability).
  using EepromGetFn = std::function<void(uint32_t index, void* data, size_t length)>;
  using EepromPutFn = std::function<void(uint32_t index, const void* data, size_t length)>;

  /// Construct with default Device OS HAL functions.
  DeviceSecretsEeprom();

  /// Construct with custom EEPROM functions (for testing).
  DeviceSecretsEeprom(EepromGetFn get_fn, EepromPutFn put_fn, size_t eeprom_offset = kDefaultEepromOffset);

  /// Get the default EEPROM read function (Device OS HAL).
  /// Useful for testing with custom offset.
  static EepromGetFn DefaultEepromGet();

  /// Get the default EEPROM write function (Device OS HAL).
  /// Useful for testing with custom offset.
  static EepromPutFn DefaultEepromPut();

  // DeviceSecrets interface
  bool IsProvisioned() const override;
  pw::Result<KeyBytes> GetGatewayMasterSecret() const override;
  pw::Result<KeyBytes> GetNtagTerminalKey() const override;

  /// Provision secrets to EEPROM.
  ///
  /// @param gateway_master_secret 16-byte master secret
  /// @param ntag_terminal_key 16-byte terminal key
  /// @return OkStatus on success, error otherwise
  pw::Status Provision(const KeyBytes& gateway_master_secret,
                       const KeyBytes& ntag_terminal_key);

  /// Clear all stored secrets.
  ///
  /// Writes invalid magic bytes to mark storage as unprovisioned.
  void Clear();

 private:
  /// Header structure (packed, 8 bytes).
  struct Header {
    uint32_t magic;
    uint8_t version;
    uint16_t length;  // Length of proto data (excluding header and CRC)
    uint8_t reserved;
  } __attribute__((packed));

  static_assert(sizeof(Header) == kHeaderSize, "Header size mismatch");

  /// Load and validate secrets from EEPROM.
  ///
  /// @return true if secrets were loaded successfully
  bool LoadFromEeprom() const;

  /// Compute CRC32 over header and proto data.
  uint32_t ComputeCrc(const Header& header, pw::span<const std::byte> proto_data) const;

  EepromGetFn eeprom_get_;
  EepromPutFn eeprom_put_;
  size_t eeprom_offset_;

  // Cached state (mutable for lazy loading in const methods)
  mutable bool loaded_ = false;
  mutable bool valid_ = false;
  mutable std::array<std::byte, KeyBytes::kSize> gateway_master_secret_{};
  mutable std::array<std::byte, KeyBytes::kSize> ntag_terminal_key_{};
};

}  // namespace maco::secrets
