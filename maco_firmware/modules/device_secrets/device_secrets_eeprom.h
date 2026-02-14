// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file device_secrets_eeprom.h
/// @brief Flash-backed implementation of DeviceSecrets for P2.
///
/// Uses raw external flash via hal_storage API to bypass LittleFS.
/// LittleFS filesystem mutex (FsLock) deadlocks when Device OS system
/// thread holds it for cloud/ledger operations. Raw flash only uses the
/// lower-level ExFlashLock which is short-lived.
///
/// Storage format (single 4K flash sector):
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

/// Flash-backed device secrets storage.
///
/// On P2, uses raw external flash via hal_storage_* (bypasses LittleFS).
/// On host, uses injectable read/write functions for testing.
///
/// Thread safety: All public methods are thread-safe (flash HAL uses
/// its own mutex, separate from the filesystem mutex).
class DeviceSecretsEeprom : public DeviceSecrets {
 public:
  /// Storage format constants.
  static constexpr uint32_t kMagic = 0x3043414D;  // "MAC0" in little-endian
  static constexpr uint8_t kVersion = 0x01;
  static constexpr size_t kHeaderSize = 8;  // Magic(4) + Version(1) + Length(2) + Reserved(1)
  static constexpr size_t kMaxProtoSize = 64;  // More than enough for 2x16 byte keys
  static constexpr size_t kCrcSize = 4;
  static constexpr size_t kMaxTotalSize = kHeaderSize + kMaxProtoSize + kCrcSize;
  static constexpr size_t kSectorSize = 4096;

  /// Reserved flash sector for device secrets.
  /// Located in the gap between OTA region (ends 0x3E0000) and user
  /// firmware region (starts 0x480000) in the P2 external flash map.
  static constexpr uintptr_t kDefaultFlashAddress = 0x3E0000;

  /// Type for storage read/write/erase functions (for testability).
  using ReadFn = std::function<int(uintptr_t addr, uint8_t* data, size_t length)>;
  using WriteFn = std::function<int(uintptr_t addr, const uint8_t* data, size_t length)>;
  using EraseFn = std::function<int(uintptr_t addr, size_t length)>;

  /// Construct with default Device OS HAL functions.
  DeviceSecretsEeprom();

  /// Construct with custom storage functions (for testing).
  DeviceSecretsEeprom(ReadFn read_fn, WriteFn write_fn, EraseFn erase_fn,
                      uintptr_t flash_address = kDefaultFlashAddress);

  // DeviceSecrets interface
  bool IsProvisioned() const override;
  pw::Result<KeyBytes> GetGatewayMasterSecret() const override;
  pw::Result<KeyBytes> GetNtagTerminalKey() const override;

  /// Provision secrets to flash.
  ///
  /// Erases the flash sector, then writes header + proto + CRC.
  ///
  /// @param gateway_master_secret 16-byte master secret
  /// @param ntag_terminal_key 16-byte terminal key
  /// @return OkStatus on success, error otherwise
  pw::Status Provision(const KeyBytes& gateway_master_secret,
                       const KeyBytes& ntag_terminal_key);

  /// Clear all stored secrets.
  ///
  /// Erases the flash sector (all 0xFF = invalid magic).
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

  /// Load and validate secrets from flash.
  ///
  /// @return true if secrets were loaded successfully
  bool LoadFromFlash() const;

  /// Compute CRC32 over header and proto data.
  uint32_t ComputeCrc(const Header& header, pw::span<const std::byte> proto_data) const;

  ReadFn read_fn_;
  WriteFn write_fn_;
  EraseFn erase_fn_;
  uintptr_t flash_address_;

  // Cached state (mutable for lazy loading in const methods)
  mutable bool loaded_ = false;
  mutable bool valid_ = false;
  mutable std::array<std::byte, KeyBytes::kSize> gateway_master_secret_{};
  mutable std::array<std::byte, KeyBytes::kSize> ntag_terminal_key_{};
};

}  // namespace maco::secrets
