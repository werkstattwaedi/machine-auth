// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_cloud/particle_ledger_backend.h"

#include <cstdlib>
#include <cstring>

#include "system_ledger.h"

#define PW_LOG_MODULE_NAME "pb_ledger"

#include "pw_log/log.h"

namespace pb::cloud {
namespace {

// -- Threading Model --
// Particle Device OS runs all application code and callbacks on the same
// system thread. Ledger sync callbacks are serialized with application code.
// No synchronization is needed for accessing shared state.

/// Instance pointer for static callback access.
/// Set when Instance() is first called, never cleared (singleton lives forever).
ParticleLedgerBackend* g_instance = nullptr;

/// Convert system error code to pw::Status.
pw::Status ToStatus(int error) {
  if (error == 0) {
    return pw::OkStatus();
  }
  // Map common Device OS errors
  if (error == -1) {
    return pw::Status::Unknown();
  }
  return pw::Status::Internal();
}

}  // namespace

// -- Singleton Implementation --

ParticleLedgerBackend& ParticleLedgerBackend::Instance() {
  static ParticleLedgerBackend instance;
  return instance;
}

// -- ParticleLedgerBackend Implementation --

ParticleLedgerBackend::ParticleLedgerBackend() {
  g_instance = this;
  PW_LOG_INFO("ParticleLedgerBackend constructed at %p",
              static_cast<void*>(this));
}

ParticleLedgerBackend::~ParticleLedgerBackend() {
  PW_LOG_INFO("ParticleLedgerBackend destructing");
}

pw::Result<LedgerHandle> ParticleLedgerBackend::GetLedger(
    std::string_view name) {
  // Copy name to null-terminated string
  pw::InlineString<kMaxLedgerNameSize> name_str(name);

  ledger_instance* ledger = nullptr;
  int result = ledger_get_instance(&ledger, name_str.c_str(), nullptr);

  if (result != 0 || ledger == nullptr) {
    PW_LOG_ERROR("Failed to get ledger '%s': error=%d", name_str.c_str(),
                 result);
    return pw::Status::Internal();
  }

  PW_LOG_INFO("Got ledger '%s' at %p", name_str.c_str(),
              static_cast<void*>(ledger));

  // Create handle - the instance pointer is the ledger_instance*
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* instance = reinterpret_cast<internal::LedgerInstance*>(ledger);
  return MakeHandle(instance);
}

SyncEventReceiver ParticleLedgerBackend::SubscribeToSync(
    std::string_view name) {
  Subscription* sub = FindOrCreateSubscription(name);
  if (sub == nullptr) {
    pw::InlineString<kMaxLedgerNameSize> name_str(name);
    PW_LOG_ERROR("Failed to create subscription for '%s'", name_str.c_str());
    // Return a dummy receiver - caller will get closed channel
    static pw::async2::ChannelStorage<SyncEvent, 1> dummy_storage;
    auto [h, s, r] = pw::async2::CreateSpscChannel<SyncEvent>(dummy_storage);
    s.Disconnect();
    return std::move(r);
  }

  // Recreate channel
  if (sub->sender.is_open()) {
    sub->sender.Disconnect();
  }
  sub->handle = {};

  auto [handle, sender, receiver] =
      pw::async2::CreateSpscChannel<SyncEvent>(sub->storage);
  sub->handle = std::move(handle);
  sub->sender = std::move(sender);

  // Get the ledger and set up the sync callback
  pw::InlineString<kMaxLedgerNameSize> name_str(name);
  ledger_instance* ledger = nullptr;
  int result = ledger_get_instance(&ledger, name_str.c_str(), nullptr);
  if (result == 0 && ledger != nullptr) {
    // Set callback
    ledger_callbacks callbacks{};
    callbacks.version = LEDGER_API_VERSION;
    callbacks.sync = [](ledger_instance* ledger, void* /*app_data*/) {
      OnLedgerSync(ledger, nullptr);
    };
    ledger_set_callbacks(ledger, &callbacks, nullptr);

    // Release our reference (callback will still work)
    ledger_release(ledger, nullptr);
  }

  PW_LOG_INFO("Subscribed to sync for '%s'", name_str.c_str());
  return std::move(receiver);
}

pw::Status ParticleLedgerBackend::GetLedgerNames(
    pw::Vector<pw::InlineString<kMaxLedgerNameSize>, kMaxLedgerCount>& names) {
  char** raw_names = nullptr;
  size_t count = 0;

  int result = ledger_get_names(&raw_names, &count, nullptr);
  if (result != 0) {
    PW_LOG_ERROR("Failed to get ledger names: error=%d", result);
    return ToStatus(result);
  }

  names.clear();
  for (size_t i = 0; i < count && !names.full(); ++i) {
    if (raw_names[i] != nullptr) {
      names.push_back(pw::InlineString<kMaxLedgerNameSize>(raw_names[i]));
      std::free(raw_names[i]);
    }
  }
  std::free(raw_names);

  PW_LOG_INFO("Got %d ledger names", static_cast<int>(names.size()));
  return pw::OkStatus();
}

pw::Status ParticleLedgerBackend::Purge(std::string_view name) {
  pw::InlineString<kMaxLedgerNameSize> name_str(name);
  int result = ledger_purge(name_str.c_str(), nullptr);
  if (result != 0) {
    PW_LOG_ERROR("Failed to purge ledger '%s': error=%d", name_str.c_str(),
                 result);
  }
  return ToStatus(result);
}

pw::Status ParticleLedgerBackend::PurgeAll() {
  int result = ledger_purge_all(nullptr);
  if (result != 0) {
    PW_LOG_ERROR("Failed to purge all ledgers: error=%d", result);
  }
  return ToStatus(result);
}

void ParticleLedgerBackend::ReleaseLedger(internal::LedgerInstance* instance) {
  if (instance == nullptr) {
    return;
  }
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* ledger = reinterpret_cast<ledger_instance*>(instance);
  ledger_release(ledger, nullptr);
  PW_LOG_DEBUG("Released ledger at %p", static_cast<void*>(ledger));
}

pw::Result<LedgerInfo> ParticleLedgerBackend::DoGetInfo(
    internal::LedgerInstance* instance) {
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* ledger = reinterpret_cast<ledger_instance*>(instance);

  ledger_info info{};
  info.version = LEDGER_API_VERSION;

  int result = ledger_get_info(ledger, &info, nullptr);
  if (result != 0) {
    PW_LOG_ERROR("Failed to get ledger info: error=%d", result);
    return ToStatus(result);
  }

  LedgerInfo out;
  if (info.name != nullptr) {
    out.name = pw::InlineString<kMaxLedgerNameSize>(info.name);
  }
  out.last_updated = info.last_updated;
  out.last_synced = info.last_synced;
  out.data_size = info.data_size;

  switch (info.scope) {
    case LEDGER_SCOPE_DEVICE:
      out.scope = LedgerScope::kDevice;
      break;
    case LEDGER_SCOPE_PRODUCT:
      out.scope = LedgerScope::kProduct;
      break;
    case LEDGER_SCOPE_OWNER:
      out.scope = LedgerScope::kOwner;
      break;
    default:
      out.scope = LedgerScope::kUnknown;
      break;
  }

  switch (info.sync_direction) {
    case LEDGER_SYNC_DIRECTION_DEVICE_TO_CLOUD:
      out.sync_direction = SyncDirection::kDeviceToCloud;
      break;
    case LEDGER_SYNC_DIRECTION_CLOUD_TO_DEVICE:
      out.sync_direction = SyncDirection::kCloudToDevice;
      break;
    default:
      out.sync_direction = SyncDirection::kUnknown;
      break;
  }

  out.sync_pending = (info.flags & LEDGER_INFO_SYNC_PENDING) != 0;

  return out;
}

pw::Result<size_t> ParticleLedgerBackend::DoRead(
    internal::LedgerInstance* instance,
    pw::ByteSpan buffer) {
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* ledger = reinterpret_cast<ledger_instance*>(instance);

  // Open for reading
  ledger_stream* stream = nullptr;
  int result = ledger_open(&stream, ledger, LEDGER_STREAM_MODE_READ, nullptr);
  if (result != 0) {
    PW_LOG_ERROR("Failed to open ledger for read: error=%d", result);
    return ToStatus(result);
  }
  if (stream == nullptr) {
    PW_LOG_ERROR("ledger_open returned null stream");
    return pw::Status::Internal();
  }

  // Read all available data in one call
  // Note: Device OS ledger_read returns error (not 0) after all data is read,
  // so we do a single read rather than looping.
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* char_buffer = reinterpret_cast<char*>(buffer.data());
  int bytes_read = ledger_read(stream, char_buffer, buffer.size(), nullptr);

  // Close stream
  ledger_close(stream, 0, nullptr);

  if (bytes_read < 0) {
    PW_LOG_ERROR("Failed to read ledger: error=%d", bytes_read);
    return ToStatus(bytes_read);
  }

  PW_LOG_DEBUG("Read %d bytes from ledger", bytes_read);
  return static_cast<size_t>(bytes_read);
}

pw::Status ParticleLedgerBackend::DoWrite(internal::LedgerInstance* instance,
                                          pw::ConstByteSpan data) {
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* ledger = reinterpret_cast<ledger_instance*>(instance);

  if (data.size() > kMaxLedgerDataSize) {
    PW_LOG_ERROR("Data too large: %d > %d", static_cast<int>(data.size()),
                 static_cast<int>(kMaxLedgerDataSize));
    return pw::Status::ResourceExhausted();
  }

  // Open for writing
  ledger_stream* stream = nullptr;
  int result = ledger_open(&stream, ledger, LEDGER_STREAM_MODE_WRITE, nullptr);
  if (result != 0 || stream == nullptr) {
    PW_LOG_ERROR("Failed to open ledger for write: error=%d", result);
    return ToStatus(result);
  }

  // Write data
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  auto* char_data = reinterpret_cast<const char*>(data.data());
  int bytes_written = ledger_write(stream, char_data, data.size(), nullptr);

  // Close stream (commits the write)
  int close_result = ledger_close(stream, 0, nullptr);

  if (bytes_written < 0) {
    PW_LOG_ERROR("Failed to write ledger: error=%d", bytes_written);
    return ToStatus(bytes_written);
  }

  if (close_result != 0) {
    PW_LOG_ERROR("Failed to close ledger after write: error=%d", close_result);
    return ToStatus(close_result);
  }

  PW_LOG_DEBUG("Wrote %d bytes to ledger", bytes_written);
  return pw::OkStatus();
}

ParticleLedgerBackend::Subscription*
ParticleLedgerBackend::FindOrCreateSubscription(std::string_view name) {
  // Find existing
  for (auto& sub : subscriptions_) {
    if (sub.active && std::string_view(sub.name) == name) {
      return &sub;
    }
  }

  // Find empty slot
  for (auto& sub : subscriptions_) {
    if (!sub.active) {
      sub.name = pw::InlineString<kMaxLedgerNameSize>(name);
      sub.active = true;
      return &sub;
    }
  }

  return nullptr;  // All slots full
}

void ParticleLedgerBackend::OnLedgerSync(void* ledger_ptr, void* /*app_data*/) {
  if (g_instance == nullptr || ledger_ptr == nullptr) {
    return;
  }

  // Get ledger info to find the name
  auto* ledger = static_cast<ledger_instance*>(ledger_ptr);
  ledger_info info{};
  info.version = LEDGER_API_VERSION;

  int result = ledger_get_info(ledger, &info, nullptr);
  if (result != 0 || info.name == nullptr) {
    PW_LOG_ERROR("OnLedgerSync: failed to get ledger info");
    return;
  }

  std::string_view name(info.name);
  PW_LOG_INFO("Ledger sync complete: %s", info.name);

  // Find subscription and send event
  for (auto& sub : g_instance->subscriptions_) {
    if (sub.active && std::string_view(sub.name) == name) {
      SyncEvent event;
      event.name = pw::InlineString<kMaxLedgerNameSize>(name);
      if (sub.sender.is_open()) {
        (void)sub.sender.TrySend(std::move(event));
      }
      break;
    }
  }
}

}  // namespace pb::cloud
