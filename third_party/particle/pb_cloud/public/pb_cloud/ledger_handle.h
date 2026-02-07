// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file ledger_handle.h
/// @brief RAII handle for ledger instances with CBOR property API.
///
/// LedgerHandle manages the lifetime of a ledger instance and provides
/// typed property accessors for CBOR-encoded ledger data. When the handle
/// is destroyed, the underlying ledger reference is released.
///
/// Usage:
/// @code
/// auto result = backend.GetLedger("terminal-config");
/// if (result.ok()) {
///   LedgerHandle& ledger = result.value();
///
///   // Read properties (parses CBOR each call - no persistent buffer)
///   bool enabled = ledger.GetBool("enabled", false);
///   int count = ledger.GetInt("retry_count", 0);
///
///   // Modify properties using LedgerEditor
///   std::array<std::byte, 4096> buf;
///   auto editor = ledger.Edit(buf);
///   if (editor.ok()) {
///     editor.value().SetBool("enabled", true);
///     editor.value().SetInt("retry_count", 5);
///     editor.value().Commit();
///   }
/// }  // Ledger released automatically
/// @endcode
///
/// ## Stack Usage (Embedded Targets)
///
/// Property getters (GetBool, GetInt, GetString, etc.) allocate a temporary
/// buffer on the stack to read the ledger data. The size is controlled by
/// `kDefaultPropertyBufferSize` (default: 1KB).
///
/// For ledgers larger than this buffer, use Edit() with a caller-provided
/// buffer instead:
/// @code
/// std::array<std::byte, 4096> buf;  // Caller controls size
/// auto editor = ledger.Edit(buf);
/// // Access properties through editor...
/// @endcode
///
/// LedgerEditor itself uses ~800 bytes for the properties array (16 entries).
/// Combined with the Edit() buffer, plan for ~1-5KB stack usage depending
/// on buffer size chosen.

#include <array>
#include <cstring>
#include <string_view>

#include "pb_cloud/cbor.h"
#include "pb_cloud/ledger_types.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace pb::cloud {

// Forward declarations
class LedgerBackend;
class LedgerEditor;

namespace internal {
/// Opaque handle type for type safety (actual type defined by backend).
struct LedgerInstance;
}  // namespace internal

/// RAII handle for a ledger instance.
///
/// Manages the reference count of the underlying ledger. Non-copyable but
/// movable. Operations delegate to the backend for implementation.
///
/// Property getters parse CBOR from storage on each call (read-through).
/// Use LedgerEditor for modifications (read-modify-write pattern).
class LedgerHandle {
 public:
  /// Default constructor - creates an invalid handle.
  LedgerHandle() = default;

  /// Move constructor - transfers ownership.
  LedgerHandle(LedgerHandle&& other) noexcept;

  /// Move assignment - releases current and transfers ownership.
  LedgerHandle& operator=(LedgerHandle&& other) noexcept;

  /// Destructor - releases the ledger if valid.
  ~LedgerHandle();

  // Non-copyable (RAII resource)
  LedgerHandle(const LedgerHandle&) = delete;
  LedgerHandle& operator=(const LedgerHandle&) = delete;

  /// Check if handle is valid (has a ledger instance).
  bool is_valid() const { return instance_ != nullptr && backend_ != nullptr; }

  /// Explicit bool conversion.
  explicit operator bool() const { return is_valid(); }

  /// Get ledger metadata.
  ///
  /// @return LedgerInfo on success, or error status
  pw::Result<LedgerInfo> GetInfo() const;

  // -- Raw Data API (for backup/restore) --

  /// Read entire ledger contents into buffer.
  ///
  /// Performs open-read-close internally. Buffer should be at least
  /// info.data_size bytes.
  ///
  /// @param buffer Output buffer to receive data
  /// @return Number of bytes read, or error status
  pw::Result<size_t> Read(pw::ByteSpan buffer);

  /// Write data to ledger (replaces entire content).
  ///
  /// Performs open-write-close internally. Data must be <= 16KB.
  ///
  /// @param data Data to write
  /// @return OkStatus on success, or error status
  pw::Status Write(pw::ConstByteSpan data);

  // -- CBOR Property Getters (read-through) --

  /// Check if a property exists in the ledger.
  ///
  /// @param key Property key to check
  /// @return true if the key exists
  bool Has(std::string_view key);

  /// Get a boolean property.
  ///
  /// @param key Property key
  /// @param default_value Value to return if key not found or type mismatch
  /// @return The boolean value or default_value
  bool GetBool(std::string_view key, bool default_value = false);

  /// Get a signed 32-bit integer property.
  ///
  /// @param key Property key
  /// @param default_value Value to return if key not found or type mismatch
  /// @return The integer value or default_value
  int32_t GetInt(std::string_view key, int32_t default_value = 0);

  /// Get a signed 64-bit integer property.
  ///
  /// @param key Property key
  /// @param default_value Value to return if key not found or type mismatch
  /// @return The integer value or default_value
  int64_t GetInt64(std::string_view key, int64_t default_value = 0);

  /// Get an unsigned 32-bit integer property.
  ///
  /// @param key Property key
  /// @param default_value Value to return if key not found or type mismatch
  /// @return The unsigned value or default_value
  uint32_t GetUint(std::string_view key, uint32_t default_value = 0);

  /// Get an unsigned 64-bit integer property.
  ///
  /// @param key Property key
  /// @param default_value Value to return if key not found or type mismatch
  /// @return The unsigned value or default_value
  uint64_t GetUint64(std::string_view key, uint64_t default_value = 0);

  /// Get a double-precision float property.
  ///
  /// @param key Property key
  /// @param default_value Value to return if key not found or type mismatch
  /// @return The double value or default_value
  double GetDouble(std::string_view key, double default_value = 0.0);

  /// Get a string property into a caller-provided buffer.
  ///
  /// @param key Property key
  /// @param buffer Buffer to receive the string data
  /// @return Number of bytes written on success, or error if key not found,
  ///         type mismatch, or buffer too small
  pw::Result<size_t> GetString(std::string_view key, pw::ByteSpan buffer);

  /// Get a byte string property into a caller-provided buffer.
  ///
  /// @param key Property key
  /// @param buffer Buffer to receive the bytes
  /// @return Number of bytes written on success, or error if key not found,
  ///         type mismatch, or buffer too small
  pw::Result<size_t> GetBytes(std::string_view key, pw::ByteSpan buffer);

  // -- Modification API --

  /// Start editing the ledger properties.
  ///
  /// Loads the current CBOR data into the provided buffer and returns a
  /// LedgerEditor for making modifications. Call Commit() on the editor
  /// to write changes back to the ledger.
  ///
  /// @param buffer Working buffer for read-modify-write operations
  /// @return LedgerEditor on success, or error if buffer too small for data
  pw::Result<LedgerEditor> Edit(pw::ByteSpan buffer);

 private:
  friend class LedgerBackend;
  friend class LedgerEditor;

  /// Private constructor - only LedgerBackend::MakeHandle can create valid handles.
  LedgerHandle(internal::LedgerInstance* instance, LedgerBackend* backend)
      : instance_(instance), backend_(backend) {}

  /// Release the ledger instance.
  void Release();

  /// Internal helper to find a key in CBOR data and position decoder at value.
  /// Returns true if key found, false otherwise.
  /// Caller must provide buffer for reading the ledger data.
  bool FindKey(std::string_view target_key, cbor::Decoder& decoder,
               pw::ByteSpan read_buffer);

  internal::LedgerInstance* instance_ = nullptr;
  LedgerBackend* backend_ = nullptr;
};

}  // namespace pb::cloud
