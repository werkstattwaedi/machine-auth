// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file ledger_backend.h
/// @brief Abstract ledger backend interface for Particle Ledger API.
///
/// Provides dependency-injectable interface for ledger operations:
/// - Production: ParticleLedgerBackend (system_ledger dynalib)
/// - Testing: MockLedgerBackend (in-memory simulation)
///
/// Usage (dependency injection):
/// @code
/// class MyComponent {
///  public:
///   explicit MyComponent(pb::cloud::LedgerBackend& ledger) : ledger_(ledger) {}
///
///   void SaveConfig(const Config& config) {
///     auto result = ledger_.GetLedger("device-config");
///     if (result.ok()) {
///       result.value().Write(config_data);
///     }
///   }
///
///  private:
///   pb::cloud::LedgerBackend& ledger_;
/// };
///
/// // Application wiring:
/// ParticleLedgerBackend ledger;  // or MockLedgerBackend in tests
/// MyComponent component(ledger);
/// @endcode

#include <array>
#include <string_view>

#include "pb_cloud/ledger_editor.h"
#include "pb_cloud/ledger_handle.h"
#include "pb_cloud/ledger_types.h"
#include "pw_async2/channel.h"
#include "pw_containers/vector.h"
#include "pw_result/result.h"
#include "pw_status/status.h"
#include "pw_status/try.h"
#include "pw_string/string.h"

namespace pb::cloud {

/// Receiver for ledger sync events (from Channel).
/// Call receiver.Receive() to get a future that resolves when ledger syncs.
using SyncEventReceiver = pw::async2::Receiver<SyncEvent>;

/// Sender for ledger sync events (used internally by backends).
using SyncEventSender = pw::async2::Sender<SyncEvent>;

/// Abstract ledger backend interface.
///
/// Implementations:
/// - ParticleLedgerBackend: Real implementation using system_ledger dynalib
/// - MockLedgerBackend: Mock for testing and simulation
class LedgerBackend {
 public:
  virtual ~LedgerBackend() = default;

  // -- Ledger Access --

  /// Get a handle to a ledger by name.
  ///
  /// The returned handle manages the ledger's reference count. When the
  /// handle is destroyed, the ledger reference is released.
  ///
  /// @param name Ledger name (max 32 chars)
  /// @return LedgerHandle on success, or error status
  virtual pw::Result<LedgerHandle> GetLedger(std::string_view name) = 0;

  // -- Sync Notifications --

  /// Subscribe to sync events for a specific ledger.
  ///
  /// Returns a Receiver channel handle. Events are delivered when the
  /// ledger syncs with the cloud. Caller polls the receiver to get events.
  ///
  /// Note: Each call creates a new subscription channel. Only one active
  /// subscription per ledger is typically needed.
  ///
  /// @param name Ledger name to monitor
  /// @return Receiver handle for sync events
  virtual SyncEventReceiver SubscribeToSync(std::string_view name) = 0;

  // -- Ledger Management --

  /// Get the names of all local ledgers.
  ///
  /// @param names Output vector to receive ledger names
  /// @return OkStatus on success, or error status
  virtual pw::Status GetLedgerNames(
      pw::Vector<pw::InlineString<kMaxLedgerNameSize>, kMaxLedgerCount>&
          names) = 0;

  /// Remove local data for a specific ledger.
  ///
  /// Device must not be connected to cloud. Ledger must not be in use.
  ///
  /// @param name Ledger name to purge
  /// @return OkStatus on success, or error status
  virtual pw::Status Purge(std::string_view name) = 0;

  /// Remove local data for all ledgers.
  ///
  /// Device must not be connected to cloud. No ledgers must be in use.
  ///
  /// @return OkStatus on success, or error status
  virtual pw::Status PurgeAll() = 0;

 protected:
  friend class LedgerHandle;

  /// Create a LedgerHandle from an instance pointer.
  /// Derived classes use this to create handles in GetLedger().
  LedgerHandle MakeHandle(internal::LedgerInstance* instance) {
    return LedgerHandle(instance, this);
  }

  // -- Implementation hooks for LedgerHandle --

  /// Release a ledger instance reference.
  /// Called by LedgerHandle destructor.
  virtual void ReleaseLedger(internal::LedgerInstance* instance) = 0;

  /// Get ledger info from instance.
  /// Called by LedgerHandle::GetInfo().
  virtual pw::Result<LedgerInfo> DoGetInfo(
      internal::LedgerInstance* instance) = 0;

  /// Read entire ledger contents.
  /// Called by LedgerHandle::Read().
  virtual pw::Result<size_t> DoRead(internal::LedgerInstance* instance,
                                    pw::ByteSpan buffer) = 0;

  /// Write entire ledger contents.
  /// Called by LedgerHandle::Write().
  virtual pw::Status DoWrite(internal::LedgerInstance* instance,
                             pw::ConstByteSpan data) = 0;
};

// -- LedgerHandle Implementation --
// Defined here after LedgerBackend is complete.

inline LedgerHandle::LedgerHandle(LedgerHandle&& other) noexcept
    : instance_(other.instance_), backend_(other.backend_) {
  other.instance_ = nullptr;
  other.backend_ = nullptr;
}

inline LedgerHandle& LedgerHandle::operator=(LedgerHandle&& other) noexcept {
  if (this != &other) {
    Release();
    instance_ = other.instance_;
    backend_ = other.backend_;
    other.instance_ = nullptr;
    other.backend_ = nullptr;
  }
  return *this;
}

inline LedgerHandle::~LedgerHandle() { Release(); }

inline void LedgerHandle::Release() {
  if (instance_ && backend_) {
    backend_->ReleaseLedger(instance_);
    instance_ = nullptr;
    backend_ = nullptr;
  }
}

inline pw::Result<LedgerInfo> LedgerHandle::GetInfo() const {
  if (!is_valid()) {
    return pw::Status::FailedPrecondition();
  }
  return backend_->DoGetInfo(instance_);
}

inline pw::Result<size_t> LedgerHandle::Read(pw::ByteSpan buffer) {
  if (!is_valid()) {
    return pw::Status::FailedPrecondition();
  }
  return backend_->DoRead(instance_, buffer);
}

inline pw::Status LedgerHandle::Write(pw::ConstByteSpan data) {
  if (!is_valid()) {
    return pw::Status::FailedPrecondition();
  }
  return backend_->DoWrite(instance_, data);
}

// -- CBOR Property Getters Implementation --

inline bool LedgerHandle::FindKey(std::string_view target_key,
                                  cbor::Decoder& decoder,
                                  pw::ByteSpan read_buffer) {
  auto read_result = Read(read_buffer);
  if (!read_result.ok() || read_result.value() == 0) {
    return false;
  }

  decoder = cbor::Decoder(
      pw::ConstByteSpan(read_buffer.data(), read_result.value()));

  auto count_result = decoder.ReadMapHeader();
  if (!count_result.ok()) {
    return false;
  }
  size_t count = count_result.value();

  std::array<char, kMaxLedgerNameSize> key_buf{};
  for (size_t i = 0; i < count; ++i) {
    auto key_result =
        decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
    if (!key_result.ok()) {
      return false;
    }
    if (key_result.value() == target_key) {
      return true;  // Decoder is now positioned at the value
    }
    // Skip this value
    if (!decoder.SkipValue().ok()) {
      return false;
    }
  }
  return false;
}

inline bool LedgerHandle::Has(std::string_view key) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return false;
  }
  return true;
}

inline bool LedgerHandle::GetBool(std::string_view key, bool default_value) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return default_value;
  }
  auto result = decoder.ReadBool();
  return result.ok() ? result.value() : default_value;
}

inline int32_t LedgerHandle::GetInt(std::string_view key,
                                    int32_t default_value) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return default_value;
  }
  auto result = decoder.ReadInt();
  return result.ok() ? static_cast<int32_t>(result.value()) : default_value;
}

inline int64_t LedgerHandle::GetInt64(std::string_view key,
                                      int64_t default_value) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return default_value;
  }
  auto result = decoder.ReadInt();
  return result.ok() ? result.value() : default_value;
}

inline uint32_t LedgerHandle::GetUint(std::string_view key,
                                      uint32_t default_value) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return default_value;
  }
  auto result = decoder.ReadUint();
  return result.ok() ? static_cast<uint32_t>(result.value()) : default_value;
}

inline uint64_t LedgerHandle::GetUint64(std::string_view key,
                                        uint64_t default_value) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return default_value;
  }
  auto result = decoder.ReadUint();
  return result.ok() ? result.value() : default_value;
}

inline double LedgerHandle::GetDouble(std::string_view key,
                                      double default_value) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return default_value;
  }
  auto result = decoder.ReadDouble();
  return result.ok() ? result.value() : default_value;
}

inline pw::Result<size_t> LedgerHandle::GetString(std::string_view key,
                                                  pw::ByteSpan out_buffer) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return pw::Status::NotFound();
  }
  return decoder.ReadString(out_buffer);
}

inline pw::Result<size_t> LedgerHandle::GetBytes(std::string_view key,
                                                 pw::ByteSpan out_buffer) {
  std::array<std::byte, kDefaultPropertyBufferSize> buffer;
  cbor::Decoder decoder(pw::ConstByteSpan{});
  if (!FindKey(key, decoder, buffer)) {
    return pw::Status::NotFound();
  }
  return decoder.ReadBytes(out_buffer);
}

inline pw::Result<LedgerEditor> LedgerHandle::Edit(pw::ByteSpan buffer) {
  if (!is_valid()) {
    return pw::Status::FailedPrecondition();
  }

  // Read current data into the buffer
  auto read_result = Read(buffer);
  if (!read_result.ok()) {
    // If read failed for reasons other than empty, propagate the error
    if (read_result.status() != pw::Status::NotFound()) {
      return read_result.status();
    }
  }

  size_t existing_size = read_result.ok() ? read_result.value() : 0;
  return LedgerEditor(this, buffer, existing_size);
}

// -- LedgerEditor Implementation --

inline LedgerEditor::LedgerEditor(LedgerHandle* handle, pw::ByteSpan buffer,
                                  size_t existing_data_size)
    : handle_(handle), buffer_(buffer) {
  // Parse existing data into properties
  if (existing_data_size > 0) {
    cbor::Decoder decoder(
        pw::ConstByteSpan(buffer.data(), existing_data_size));
    auto count_result = decoder.ReadMapHeader();
    if (count_result.ok()) {
      size_t count = count_result.value();

      for (size_t i = 0; i < count && property_count_ < kMaxLedgerProperties;
           ++i) {
        // Read key - need to store it in our string buffer
        std::array<char, kMaxLedgerNameSize> temp_key{};
        auto key_result =
            decoder.ReadKey(pw::as_writable_bytes(pw::span(temp_key)));
        if (!key_result.ok()) {
          break;
        }

        // Copy key to our string buffer
        std::string_view key_view = key_result.value();
        auto key_alloc = AllocateBuffer(key_view.size());
        if (!key_alloc.ok()) {
          break;
        }
        std::memcpy(key_alloc.value(), key_view.data(), key_view.size());

        PropertyEntry& entry = properties_[property_count_];
        // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
        entry.key = std::string_view(
            reinterpret_cast<const char*>(key_alloc.value()), key_view.size());

        // Peek at the type and read the value
        auto type_result = decoder.PeekType();
        if (!type_result.ok()) {
          break;
        }

        entry.type = type_result.value();

        switch (entry.type) {
          case cbor::MajorType::kUnsignedInt: {
            auto val = decoder.ReadUint();
            if (!val.ok()) break;
            entry.uint_value = val.value();
            break;
          }
          case cbor::MajorType::kNegativeInt: {
            auto val = decoder.ReadInt();
            if (!val.ok()) break;
            entry.int_value = val.value();
            break;
          }
          case cbor::MajorType::kByteString: {
            // Peek at length first to allocate exactly what we need
            auto len_peek = decoder.PeekStringLength();
            if (!len_peek.ok()) break;
            size_t len = len_peek.value();

            auto bytes_result = AllocateBuffer(len);
            if (!bytes_result.ok()) break;
            auto read_len = decoder.ReadBytes(pw::ByteSpan(bytes_result.value(), len));
            if (!read_len.ok()) break;
            entry.span_value.data = bytes_result.value();
            entry.span_value.size = read_len.value();
            break;
          }
          case cbor::MajorType::kTextString: {
            // Peek at length first to allocate exactly what we need
            auto len_peek = decoder.PeekStringLength();
            if (!len_peek.ok()) break;
            size_t len = len_peek.value();

            auto str_result = AllocateBuffer(len);
            if (!str_result.ok()) break;
            auto read_len = decoder.ReadString(pw::ByteSpan(str_result.value(), len));
            if (!read_len.ok()) break;
            entry.span_value.data = str_result.value();
            entry.span_value.size = read_len.value();
            break;
          }
          case cbor::MajorType::kSimpleFloat: {
            // Check for bool, null, or float
            uint8_t peek = static_cast<uint8_t>(buffer[decoder.position()]);
            if (peek == 0xf4) {  // false
              entry.bool_value = false;
              entry.simple_value = 20;
              decoder.SkipValue();
            } else if (peek == 0xf5) {  // true
              entry.bool_value = true;
              entry.simple_value = 21;
              decoder.SkipValue();
            } else if (peek == 0xf6) {  // null
              entry.simple_value = 22;
              decoder.SkipValue();
            } else if (peek == 0xfb) {  // double
              auto val = decoder.ReadDouble();
              if (!val.ok()) break;
              entry.double_value = val.value();
              entry.simple_value = 27;
            } else {
              decoder.SkipValue();
            }
            break;
          }
          default:
            // Skip unsupported types
            decoder.SkipValue();
            continue;
        }
        ++property_count_;
      }
    }
  }
}

inline LedgerEditor::LedgerEditor(LedgerEditor&& other) noexcept
    : handle_(other.handle_),
      buffer_(other.buffer_),
      property_count_(other.property_count_),
      string_buffer_used_(other.string_buffer_used_) {
  for (size_t i = 0; i < property_count_; ++i) {
    properties_[i] = other.properties_[i];
  }
  other.handle_ = nullptr;
  other.property_count_ = 0;
}

inline LedgerEditor& LedgerEditor::operator=(LedgerEditor&& other) noexcept {
  if (this != &other) {
    handle_ = other.handle_;
    buffer_ = other.buffer_;
    property_count_ = other.property_count_;
    string_buffer_used_ = other.string_buffer_used_;
    for (size_t i = 0; i < property_count_; ++i) {
      properties_[i] = other.properties_[i];
    }
    other.handle_ = nullptr;
    other.property_count_ = 0;
  }
  return *this;
}

inline PropertyEntry* LedgerEditor::Find(std::string_view key) {
  for (size_t i = 0; i < property_count_; ++i) {
    if (!properties_[i].removed && properties_[i].key == key) {
      return &properties_[i];
    }
  }
  return nullptr;
}

inline pw::Result<PropertyEntry*> LedgerEditor::FindOrCreate(
    std::string_view key) {
  // First check if it exists
  PropertyEntry* existing = Find(key);
  if (existing) {
    return existing;
  }

  // Check for a removed entry we can reuse
  for (size_t i = 0; i < property_count_; ++i) {
    if (properties_[i].removed) {
      properties_[i].removed = false;
      // Need to allocate key storage
      auto key_alloc = AllocateBuffer(key.size());
      if (!key_alloc.ok()) {
        return key_alloc.status();
      }
      std::memcpy(key_alloc.value(), key.data(), key.size());
      // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
      properties_[i].key = std::string_view(
          reinterpret_cast<const char*>(key_alloc.value()), key.size());
      return &properties_[i];
    }
  }

  // Create new entry
  if (property_count_ >= kMaxLedgerProperties) {
    return pw::Status::ResourceExhausted();
  }

  // Allocate key storage
  auto key_alloc = AllocateBuffer(key.size());
  if (!key_alloc.ok()) {
    return key_alloc.status();
  }
  std::memcpy(key_alloc.value(), key.data(), key.size());

  PropertyEntry& entry = properties_[property_count_++];
  entry = PropertyEntry{};
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  entry.key = std::string_view(
      reinterpret_cast<const char*>(key_alloc.value()), key.size());
  return &entry;
}

inline pw::Result<std::byte*> LedgerEditor::AllocateBuffer(size_t size) {
  // String buffer grows from the end of the main buffer backwards
  if (string_buffer_used_ + size > buffer_.size() / 2) {
    // Reserve half the buffer for CBOR output
    return pw::Status::ResourceExhausted();
  }
  std::byte* ptr = buffer_.data() + buffer_.size() - string_buffer_used_ - size;
  string_buffer_used_ += size;
  return ptr;
}

inline pw::Status LedgerEditor::SetBool(std::string_view key, bool value) {
  auto entry_result = FindOrCreate(key);
  if (!entry_result.ok()) {
    return entry_result.status();
  }
  PropertyEntry* entry = entry_result.value();
  entry->type = cbor::MajorType::kSimpleFloat;
  entry->simple_value = value ? 21 : 20;  // true=21, false=20
  entry->bool_value = value;
  return pw::OkStatus();
}

inline pw::Status LedgerEditor::SetInt(std::string_view key, int64_t value) {
  auto entry_result = FindOrCreate(key);
  if (!entry_result.ok()) {
    return entry_result.status();
  }
  PropertyEntry* entry = entry_result.value();
  if (value >= 0) {
    entry->type = cbor::MajorType::kUnsignedInt;
    entry->uint_value = static_cast<uint64_t>(value);
  } else {
    entry->type = cbor::MajorType::kNegativeInt;
    entry->int_value = value;
  }
  return pw::OkStatus();
}

inline pw::Status LedgerEditor::SetUint(std::string_view key, uint64_t value) {
  auto entry_result = FindOrCreate(key);
  if (!entry_result.ok()) {
    return entry_result.status();
  }
  PropertyEntry* entry = entry_result.value();
  entry->type = cbor::MajorType::kUnsignedInt;
  entry->uint_value = value;
  return pw::OkStatus();
}

inline pw::Status LedgerEditor::SetDouble(std::string_view key, double value) {
  auto entry_result = FindOrCreate(key);
  if (!entry_result.ok()) {
    return entry_result.status();
  }
  PropertyEntry* entry = entry_result.value();
  entry->type = cbor::MajorType::kSimpleFloat;
  entry->simple_value = 27;  // double
  entry->double_value = value;
  return pw::OkStatus();
}

inline pw::Status LedgerEditor::SetString(std::string_view key,
                                          std::string_view value) {
  auto entry_result = FindOrCreate(key);
  if (!entry_result.ok()) {
    return entry_result.status();
  }

  // Allocate space for the string value
  auto value_alloc = AllocateBuffer(value.size());
  if (!value_alloc.ok()) {
    return value_alloc.status();
  }
  std::memcpy(value_alloc.value(), value.data(), value.size());

  PropertyEntry* entry = entry_result.value();
  entry->type = cbor::MajorType::kTextString;
  entry->span_value.data = value_alloc.value();
  entry->span_value.size = value.size();
  return pw::OkStatus();
}

inline pw::Status LedgerEditor::SetBytes(std::string_view key,
                                         pw::ConstByteSpan value) {
  auto entry_result = FindOrCreate(key);
  if (!entry_result.ok()) {
    return entry_result.status();
  }

  // Allocate space for the bytes
  auto value_alloc = AllocateBuffer(value.size());
  if (!value_alloc.ok()) {
    return value_alloc.status();
  }
  std::memcpy(value_alloc.value(), value.data(), value.size());

  PropertyEntry* entry = entry_result.value();
  entry->type = cbor::MajorType::kByteString;
  entry->span_value.data = value_alloc.value();
  entry->span_value.size = value.size();
  return pw::OkStatus();
}

inline pw::Status LedgerEditor::Remove(std::string_view key) {
  PropertyEntry* entry = Find(key);
  if (entry) {
    entry->removed = true;
  }
  return pw::OkStatus();
}

inline size_t LedgerEditor::property_count() const {
  size_t count = 0;
  for (size_t i = 0; i < property_count_; ++i) {
    if (!properties_[i].removed) {
      ++count;
    }
  }
  return count;
}

inline pw::Status LedgerEditor::Commit() {
  if (!handle_ || !handle_->is_valid()) {
    return pw::Status::FailedPrecondition();
  }

  // Count non-removed properties
  size_t active_count = property_count();

  // Encode to CBOR
  cbor::Encoder encoder(buffer_);
  PW_TRY(encoder.BeginMap(active_count));

  for (size_t i = 0; i < property_count_; ++i) {
    const PropertyEntry& entry = properties_[i];
    if (entry.removed) {
      continue;
    }

    switch (entry.type) {
      case cbor::MajorType::kUnsignedInt:
        PW_TRY(encoder.WriteUint(entry.key, entry.uint_value));
        break;
      case cbor::MajorType::kNegativeInt:
        PW_TRY(encoder.WriteInt(entry.key, entry.int_value));
        break;
      case cbor::MajorType::kByteString:
        PW_TRY(encoder.WriteBytes(
            entry.key, pw::ConstByteSpan(entry.span_value.data,
                                         entry.span_value.size)));
        break;
      case cbor::MajorType::kTextString:
        // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
        PW_TRY(encoder.WriteString(
            entry.key,
            std::string_view(
                reinterpret_cast<const char*>(entry.span_value.data),
                entry.span_value.size)));
        break;
      case cbor::MajorType::kSimpleFloat:
        if (entry.simple_value == 20 || entry.simple_value == 21) {
          PW_TRY(encoder.WriteBool(entry.key, entry.bool_value));
        } else if (entry.simple_value == 22) {
          PW_TRY(encoder.WriteNull(entry.key));
        } else if (entry.simple_value == 27) {
          PW_TRY(encoder.WriteDouble(entry.key, entry.double_value));
        }
        break;
      default:
        // Skip unsupported types
        break;
    }
  }

  // Write the encoded data to the ledger
  return handle_->Write(pw::ConstByteSpan(buffer_.data(), encoder.size()));
}

}  // namespace pb::cloud
