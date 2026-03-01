// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_kvs/flash_memory.h"

#include <cstring>

#include "pw_log/log.h"

#define PARTICLE_USE_UNSTABLE_API
#include "storage_hal.h"

namespace pb::kvs {

ParticleFlashMemory::ParticleFlashMemory(uint32_t start_address,
                                         size_t sector_count)
    : FlashMemory(kSectorSize, sector_count, kAlignment, start_address),
      base_address_(start_address) {}

pw::Status ParticleFlashMemory::Enable() {
  enabled_ = true;
  return pw::OkStatus();
}

pw::Status ParticleFlashMemory::Disable() {
  enabled_ = false;
  return pw::OkStatus();
}

bool ParticleFlashMemory::IsEnabled() const { return enabled_; }

pw::Status ParticleFlashMemory::Erase(Address address, size_t num_sectors) {
  const uintptr_t abs_address = base_address_ + address;
  const size_t erase_size = num_sectors * kSectorSize;

  int result =
      hal_storage_erase(HAL_STORAGE_ID_EXTERNAL_FLASH, abs_address, erase_size);
  if (result < 0) {
    PW_LOG_ERROR("Flash erase failed at 0x%08X: %d",
                 static_cast<unsigned>(abs_address), result);
    return pw::Status::Internal();
  }
  return pw::OkStatus();
}

pw::StatusWithSize ParticleFlashMemory::Read(Address address,
                                             pw::span<std::byte> output) {
  const uintptr_t abs_address = base_address_ + address;

  int result = hal_storage_read(
      HAL_STORAGE_ID_EXTERNAL_FLASH, abs_address,
      reinterpret_cast<uint8_t*>(output.data()), output.size());
  if (result < 0) {
    PW_LOG_ERROR("Flash read failed at 0x%08X: %d",
                 static_cast<unsigned>(abs_address), result);
    return pw::StatusWithSize::Internal();
  }
  return pw::StatusWithSize(output.size());
}

pw::StatusWithSize ParticleFlashMemory::Write(
    Address address, pw::span<const std::byte> data) {
  const uintptr_t abs_address = base_address_ + address;

  int result = hal_storage_write(
      HAL_STORAGE_ID_EXTERNAL_FLASH, abs_address,
      reinterpret_cast<const uint8_t*>(data.data()), data.size());
  if (result < 0) {
    PW_LOG_ERROR("Flash write failed at 0x%08X: %d",
                 static_cast<unsigned>(abs_address), result);
    return pw::StatusWithSize::Internal();
  }
  return pw::StatusWithSize(data.size());
}

}  // namespace pb::kvs
