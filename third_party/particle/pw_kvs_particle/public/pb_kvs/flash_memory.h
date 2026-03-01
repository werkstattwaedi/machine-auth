// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_kvs/flash_memory.h"

namespace pb::kvs {

/// pw_kvs FlashMemory backend for Particle P2 external flash.
///
/// Wraps the Device OS hal_storage_* API (raw SPI NOR flash access) into
/// Pigweed's FlashMemory interface. This bypasses LittleFS entirely,
/// avoiding the FsLock deadlock with the Device OS system thread
/// (uses only the short-lived ExFlashLock SPI bus mutex).
///
/// The caller configures the flash region via constructor parameters.
/// This class contains no application-specific logic.
class ParticleFlashMemory : public pw::kvs::FlashMemory {
 public:
  static constexpr size_t kSectorSize = 4096;
  static constexpr size_t kAlignment = 1;  // NOR flash is byte-addressable

  /// Construct a flash memory instance for a region of external flash.
  ///
  /// @param start_address Absolute address in external flash (e.g. 0x3E1000)
  /// @param sector_count Number of 4KB sectors in this region
  ParticleFlashMemory(uint32_t start_address, size_t sector_count);

  pw::Status Enable() override;
  pw::Status Disable() override;
  bool IsEnabled() const override;

  pw::Status Erase(Address address, size_t num_sectors) override;
  pw::StatusWithSize Read(Address address, pw::span<std::byte> output) override;
  pw::StatusWithSize Write(Address address,
                           pw::span<const std::byte> data) override;

 private:
  uint32_t base_address_;
  bool enabled_ = false;
};

}  // namespace pb::kvs
