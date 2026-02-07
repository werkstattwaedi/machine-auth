// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file particle_ledger_backend.h
/// @brief Particle Ledger backend singleton for P2 devices.
///
/// Provides a singleton implementation of LedgerBackend for Particle devices.
/// Use dependency injection with LedgerBackend& for testability.
///
/// Usage:
/// @code
/// // Get the singleton instance
/// auto& ledger = pb::cloud::ParticleLedgerBackend::Instance();
///
/// // Pass to components via dependency injection
/// MyComponent component(ledger);  // Takes LedgerBackend&
/// @endcode

#include <array>
#include <string_view>

#include "pb_cloud/ledger_backend.h"
#include "pw_async2/channel.h"
#include "pw_string/string.h"

namespace pb::cloud {

/// Default channel capacity for sync event buffering.
inline constexpr uint16_t kSyncChannelCapacity = 4;

/// Particle Ledger backend implementation using system_ledger dynalib.
///
/// This is a singleton - use Instance() to get the single instance.
/// Only one instance is allowed (enforced at compile time via private ctor).
class ParticleLedgerBackend : public LedgerBackend {
 public:
  /// Get the singleton instance.
  ///
  /// @return Reference to the ParticleLedgerBackend instance
  static ParticleLedgerBackend& Instance();

  // Non-copyable, non-movable
  ParticleLedgerBackend(const ParticleLedgerBackend&) = delete;
  ParticleLedgerBackend& operator=(const ParticleLedgerBackend&) = delete;
  ParticleLedgerBackend(ParticleLedgerBackend&&) = delete;
  ParticleLedgerBackend& operator=(ParticleLedgerBackend&&) = delete;

  // -- LedgerBackend interface --

  pw::Result<LedgerHandle> GetLedger(std::string_view name) override;
  SyncEventReceiver SubscribeToSync(std::string_view name) override;
  pw::Status GetLedgerNames(
      pw::Vector<pw::InlineString<kMaxLedgerNameSize>, kMaxLedgerCount>& names)
      override;
  pw::Status Purge(std::string_view name) override;
  pw::Status PurgeAll() override;

 protected:
  void ReleaseLedger(internal::LedgerInstance* instance) override;
  pw::Result<LedgerInfo> DoGetInfo(internal::LedgerInstance* instance) override;
  pw::Result<size_t> DoRead(internal::LedgerInstance* instance,
                            pw::ByteSpan buffer) override;
  pw::Status DoWrite(internal::LedgerInstance* instance,
                     pw::ConstByteSpan data) override;

 private:
  // Private constructor for singleton pattern
  ParticleLedgerBackend();
  ~ParticleLedgerBackend();

  // Per-ledger subscription tracking
  struct Subscription {
    pw::InlineString<kMaxLedgerNameSize> name;
    pw::async2::ChannelStorage<SyncEvent, kSyncChannelCapacity> storage;
    pw::async2::SpscChannelHandle<SyncEvent> handle;
    pw::async2::Sender<SyncEvent> sender;
    bool active = false;
  };

  /// Find or create a subscription slot for a ledger.
  Subscription* FindOrCreateSubscription(std::string_view name);

  /// Static callback for ledger sync events.
  static void OnLedgerSync(void* ledger, void* app_data);

  std::array<Subscription, kMaxLedgerCount> subscriptions_{};
};

}  // namespace pb::cloud
