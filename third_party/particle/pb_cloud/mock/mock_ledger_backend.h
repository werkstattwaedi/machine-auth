// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file mock_ledger_backend.h
/// @brief Mock ledger backend for testing.
///
/// Provides simulation helpers to inject ledger data and control sync events.
/// Includes property helpers that encode/decode CBOR for easier test setup.
///
/// Usage:
/// @code
/// MockLedgerBackend mock;
///
/// // Pre-populate ledger data (raw bytes)
/// std::byte data[] = {std::byte{0x01}, std::byte{0x02}};
/// mock.SetLedgerData("my-ledger", data);
///
/// // Or use property helpers (encodes as CBOR)
/// mock.SetProperty("my-ledger", "enabled", true);
/// mock.SetProperty("my-ledger", "count", 42);
///
/// // Read it back via the backend
/// auto handle = mock.GetLedger("my-ledger");
/// bool enabled = handle.value().GetBool("enabled", false);
///
/// // Simulate a sync event
/// auto receiver = mock.SubscribeToSync("my-ledger");
/// mock.SimulateSyncComplete("my-ledger");
/// @endcode

#include <array>
#include <cstring>

#include "pb_cloud/cbor.h"
#include "pb_cloud/ledger_backend.h"
#include "pw_assert/check.h"

namespace pb::cloud {

/// Default channel capacity for mock sync event buffering.
inline constexpr uint16_t kMockSyncChannelCapacity = 4;

/// Mock ledger backend for testing.
///
/// Provides in-memory ledger storage and sync event simulation.
class MockLedgerBackend : public LedgerBackend {
 public:
  MockLedgerBackend() = default;

  // -- LedgerBackend Interface --

  pw::Result<LedgerHandle> GetLedger(std::string_view name) override {
    // Find existing or create new slot
    size_t slot = FindOrCreateLedger(name);
    if (slot >= kMaxLedgerCount) {
      return pw::Status::ResourceExhausted();
    }

    // Return handle with slot index as "instance" pointer
    // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast,performance-no-int-to-ptr)
    auto* instance = reinterpret_cast<internal::LedgerInstance*>(slot + 1);
    return MakeHandle(instance);
  }

  SyncEventReceiver SubscribeToSync(std::string_view name) override {
    // Find the ledger slot
    size_t slot = FindLedger(name);
    if (slot >= kMaxLedgerCount) {
      // Create the ledger if it doesn't exist
      slot = FindOrCreateLedger(name);
    }

    // Create/recreate channel for this ledger
    if (ledgers_[slot].sync_sender.is_open()) {
      ledgers_[slot].sync_sender.Disconnect();
    }
    ledgers_[slot].sync_channel_handle = {};

    auto [handle, sender, receiver] =
        pw::async2::CreateSpscChannel<SyncEvent>(ledgers_[slot].sync_storage);
    ledgers_[slot].sync_channel_handle = std::move(handle);
    ledgers_[slot].sync_sender = std::move(sender);

    return std::move(receiver);
  }

  pw::Status GetLedgerNames(
      pw::Vector<pw::InlineString<kMaxLedgerNameSize>, kMaxLedgerCount>& names)
      override {
    names.clear();
    for (size_t i = 0; i < ledger_count_; ++i) {
      if (!ledgers_[i].name.empty()) {
        names.push_back(ledgers_[i].name);
      }
    }
    return pw::OkStatus();
  }

  pw::Status Purge(std::string_view name) override {
    size_t slot = FindLedger(name);
    if (slot >= kMaxLedgerCount) {
      return pw::Status::NotFound();
    }
    ledgers_[slot].data_size = 0;
    return pw::OkStatus();
  }

  pw::Status PurgeAll() override {
    for (size_t i = 0; i < ledger_count_; ++i) {
      ledgers_[i].data_size = 0;
    }
    return pw::OkStatus();
  }

  // -- Simulation Helpers --

  /// Set the data for a ledger (creates ledger if needed).
  void SetLedgerData(std::string_view name, pw::ConstByteSpan data) {
    size_t slot = FindOrCreateLedger(name);
    PW_CHECK(slot < kMaxLedgerCount, "Too many ledgers");
    PW_CHECK(data.size() <= kMaxLedgerDataSize, "Data too large");

    std::memcpy(ledgers_[slot].data.data(), data.data(), data.size());
    ledgers_[slot].data_size = data.size();
    ledgers_[slot].info.data_size = data.size();
    ledgers_[slot].info.last_updated = 1000;  // Arbitrary timestamp
  }

  // -- Property Helpers (CBOR encoding/decoding) --

  /// Set a boolean property (encodes as CBOR).
  void SetProperty(std::string_view ledger_name, std::string_view key,
                   bool value) {
    auto handle = GetLedger(ledger_name);
    PW_CHECK(handle.ok());
    std::array<std::byte, 4096> buffer;
    auto editor = handle.value().Edit(buffer);
    PW_CHECK(editor.ok());
    PW_CHECK(editor.value().SetBool(key, value).ok());
    PW_CHECK(editor.value().Commit().ok());
  }

  /// Set an integer property (encodes as CBOR).
  void SetProperty(std::string_view ledger_name, std::string_view key,
                   int64_t value) {
    auto handle = GetLedger(ledger_name);
    PW_CHECK(handle.ok());
    std::array<std::byte, 4096> buffer;
    auto editor = handle.value().Edit(buffer);
    PW_CHECK(editor.ok());
    PW_CHECK(editor.value().SetInt(key, value).ok());
    PW_CHECK(editor.value().Commit().ok());
  }

  /// Set an unsigned integer property (encodes as CBOR).
  void SetProperty(std::string_view ledger_name, std::string_view key,
                   uint64_t value) {
    auto handle = GetLedger(ledger_name);
    PW_CHECK(handle.ok());
    std::array<std::byte, 4096> buffer;
    auto editor = handle.value().Edit(buffer);
    PW_CHECK(editor.ok());
    PW_CHECK(editor.value().SetUint(key, value).ok());
    PW_CHECK(editor.value().Commit().ok());
  }

  /// Set a double property (encodes as CBOR).
  void SetProperty(std::string_view ledger_name, std::string_view key,
                   double value) {
    auto handle = GetLedger(ledger_name);
    PW_CHECK(handle.ok());
    std::array<std::byte, 4096> buffer;
    auto editor = handle.value().Edit(buffer);
    PW_CHECK(editor.ok());
    PW_CHECK(editor.value().SetDouble(key, value).ok());
    PW_CHECK(editor.value().Commit().ok());
  }

  /// Set a string property (encodes as CBOR).
  void SetProperty(std::string_view ledger_name, std::string_view key,
                   std::string_view value) {
    auto handle = GetLedger(ledger_name);
    PW_CHECK(handle.ok());
    std::array<std::byte, 4096> buffer;
    auto editor = handle.value().Edit(buffer);
    PW_CHECK(editor.ok());
    PW_CHECK(editor.value().SetString(key, value).ok());
    PW_CHECK(editor.value().Commit().ok());
  }

  /// Get a boolean property (decodes from CBOR).
  bool GetPropertyBool(std::string_view ledger_name, std::string_view key,
                       bool default_value = false) {
    auto handle = GetLedger(ledger_name);
    if (!handle.ok()) return default_value;
    return handle.value().GetBool(key, default_value);
  }

  /// Get an integer property (decodes from CBOR).
  int64_t GetPropertyInt(std::string_view ledger_name, std::string_view key,
                         int64_t default_value = 0) {
    auto handle = GetLedger(ledger_name);
    if (!handle.ok()) return default_value;
    return handle.value().GetInt64(key, default_value);
  }

  /// Get an unsigned integer property (decodes from CBOR).
  uint64_t GetPropertyUint(std::string_view ledger_name, std::string_view key,
                           uint64_t default_value = 0) {
    auto handle = GetLedger(ledger_name);
    if (!handle.ok()) return default_value;
    return handle.value().GetUint64(key, default_value);
  }

  /// Get a double property (decodes from CBOR).
  double GetPropertyDouble(std::string_view ledger_name, std::string_view key,
                           double default_value = 0.0) {
    auto handle = GetLedger(ledger_name);
    if (!handle.ok()) return default_value;
    return handle.value().GetDouble(key, default_value);
  }

  /// Check if a property exists (decodes from CBOR).
  bool HasProperty(std::string_view ledger_name, std::string_view key) {
    auto handle = GetLedger(ledger_name);
    if (!handle.ok()) return false;
    return handle.value().Has(key);
  }

  /// Set the info for a ledger (creates ledger if needed).
  void SetLedgerInfo(std::string_view name, const LedgerInfo& info) {
    size_t slot = FindOrCreateLedger(name);
    PW_CHECK(slot < kMaxLedgerCount, "Too many ledgers");

    ledgers_[slot].info = info;
    ledgers_[slot].info.name = pw::InlineString<kMaxLedgerNameSize>(name);
  }

  /// Simulate a sync completion event for a ledger.
  void SimulateSyncComplete(std::string_view name) {
    size_t slot = FindLedger(name);
    if (slot >= kMaxLedgerCount) {
      return;
    }

    SyncEvent event;
    event.name = pw::InlineString<kMaxLedgerNameSize>(name);

    if (ledgers_[slot].sync_sender.is_open()) {
      (void)ledgers_[slot].sync_sender.TrySend(std::move(event));
    }

    ledgers_[slot].info.last_synced = 2000;  // Arbitrary timestamp
    ledgers_[slot].info.sync_pending = false;
  }

  // -- Test Inspection --

  /// Get the data that was written to a ledger.
  pw::ConstByteSpan GetWrittenData(std::string_view name) const {
    size_t slot = FindLedger(name);
    if (slot >= kMaxLedgerCount) {
      return {};
    }
    return pw::ConstByteSpan(ledgers_[slot].data.data(),
                             ledgers_[slot].data_size);
  }

  /// Get the current ledger count.
  size_t ledger_count() const { return ledger_count_; }

  /// Reset all state (for test isolation).
  void Reset() {
    for (size_t i = 0; i < ledger_count_; ++i) {
      ledgers_[i].name.clear();
      ledgers_[i].data_size = 0;
      ledgers_[i].info = LedgerInfo{};
      if (ledgers_[i].sync_sender.is_open()) {
        ledgers_[i].sync_sender.Disconnect();
      }
      ledgers_[i].sync_channel_handle = {};
    }
    ledger_count_ = 0;
  }

 protected:
  void ReleaseLedger(internal::LedgerInstance* /*instance*/) override {
    // Mock doesn't need reference counting
  }

  pw::Result<LedgerInfo> DoGetInfo(
      internal::LedgerInstance* instance) override {
    size_t slot = InstanceToSlot(instance);
    if (slot >= kMaxLedgerCount || slot >= ledger_count_) {
      return pw::Status::InvalidArgument();
    }
    return ledgers_[slot].info;
  }

  pw::Result<size_t> DoRead(internal::LedgerInstance* instance,
                            pw::ByteSpan buffer) override {
    size_t slot = InstanceToSlot(instance);
    if (slot >= kMaxLedgerCount || slot >= ledger_count_) {
      return pw::Status::InvalidArgument();
    }

    size_t copy_size = std::min(buffer.size(), ledgers_[slot].data_size);
    std::memcpy(buffer.data(), ledgers_[slot].data.data(), copy_size);
    return copy_size;
  }

  pw::Status DoWrite(internal::LedgerInstance* instance,
                     pw::ConstByteSpan data) override {
    size_t slot = InstanceToSlot(instance);
    if (slot >= kMaxLedgerCount || slot >= ledger_count_) {
      return pw::Status::InvalidArgument();
    }

    if (data.size() > kMaxLedgerDataSize) {
      return pw::Status::ResourceExhausted();
    }

    std::memcpy(ledgers_[slot].data.data(), data.data(), data.size());
    ledgers_[slot].data_size = data.size();
    ledgers_[slot].info.data_size = data.size();
    ledgers_[slot].info.last_updated = 3000;  // Arbitrary timestamp
    ledgers_[slot].info.sync_pending = true;
    return pw::OkStatus();
  }

 private:
  /// Convert instance pointer back to slot index.
  static size_t InstanceToSlot(internal::LedgerInstance* instance) {
    // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
    return reinterpret_cast<size_t>(instance) - 1;
  }

  /// Find ledger slot by name (const version).
  size_t FindLedger(std::string_view name) const {
    for (size_t i = 0; i < ledger_count_; ++i) {
      if (std::string_view(ledgers_[i].name) == name) {
        return i;
      }
    }
    return kMaxLedgerCount;  // Not found
  }

  /// Find or create ledger slot by name.
  size_t FindOrCreateLedger(std::string_view name) {
    // First check if it exists
    size_t slot = FindLedger(name);
    if (slot < kMaxLedgerCount) {
      return slot;
    }

    // Create new slot
    if (ledger_count_ >= kMaxLedgerCount) {
      return kMaxLedgerCount;  // Full
    }

    slot = ledger_count_++;
    ledgers_[slot].name = pw::InlineString<kMaxLedgerNameSize>(name);
    ledgers_[slot].info.name = ledgers_[slot].name;
    return slot;
  }

  /// Per-ledger storage.
  struct LedgerSlot {
    pw::InlineString<kMaxLedgerNameSize> name;
    std::array<std::byte, kMaxLedgerDataSize> data{};
    size_t data_size = 0;
    LedgerInfo info{};

    // Sync event channel
    pw::async2::ChannelStorage<SyncEvent, kMockSyncChannelCapacity>
        sync_storage;
    pw::async2::SpscChannelHandle<SyncEvent> sync_channel_handle;
    pw::async2::Sender<SyncEvent> sync_sender;
  };

  std::array<LedgerSlot, kMaxLedgerCount> ledgers_{};
  size_t ledger_count_ = 0;
};

}  // namespace pb::cloud
