// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file ledger_types.h
/// @brief Core types for Particle Ledger API.
///
/// Ledgers are persistent, cloud-synchronized key-value stores.
/// This file defines types for ledger metadata and sync events.

#include <cstddef>
#include <cstdint>

#include "pw_string/string.h"

namespace pb::cloud {

/// Maximum ledger name length (Particle limit: 32 chars).
inline constexpr size_t kMaxLedgerNameSize = 32;

/// Maximum ledger data size (Particle limit: 16KB).
inline constexpr size_t kMaxLedgerDataSize = 16384;

/// Default buffer size for property getters.
/// Stack-allocated in GetBool/GetInt/etc. Use a moderate size to avoid
/// stack overflow on embedded devices. If your ledger is larger than this,
/// use Edit() with a caller-provided buffer instead.
inline constexpr size_t kDefaultPropertyBufferSize = 1024;

/// Maximum number of ledgers per device.
inline constexpr size_t kMaxLedgerCount = 16;

/// Ledger scope - determines ownership and visibility.
enum class LedgerScope : uint8_t {
  kUnknown,  ///< Unknown scope
  kDevice,   ///< Device-owned ledger
  kProduct,  ///< Product-scoped ledger
  kOwner,    ///< Owner-scoped ledger
};

/// Sync direction - controls which side is authoritative.
enum class SyncDirection : uint8_t {
  kUnknown,        ///< Unknown direction
  kDeviceToCloud,  ///< Device writes, cloud reads
  kCloudToDevice,  ///< Cloud writes, device reads
};

/// Ledger metadata information.
///
/// Returned by GetInfo() - contains ledger state and timestamps.
struct LedgerInfo {
  pw::InlineString<kMaxLedgerNameSize> name;  ///< Ledger name (owning copy)
  int64_t last_updated = 0;   ///< Last update time (ms since epoch, 0=unknown)
  int64_t last_synced = 0;    ///< Last sync time (ms since epoch, 0=never)
  size_t data_size = 0;       ///< Size of ledger data in bytes
  LedgerScope scope = LedgerScope::kUnknown;
  SyncDirection sync_direction = SyncDirection::kUnknown;
  bool sync_pending = false;  ///< True if local changes not yet synced
};

/// Sync completion event for subscription notifications.
///
/// Delivered via SyncEventReceiver when a ledger syncs with the cloud.
struct SyncEvent {
  pw::InlineString<kMaxLedgerNameSize> name;  ///< Ledger name that synced
};

}  // namespace pb::cloud
