// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file ledger_editor.h
/// @brief Scoped editor for modifying ledger properties.
///
/// LedgerEditor provides a read-modify-write pattern for updating ledger
/// properties. It uses a caller-provided buffer to hold the working copy
/// of the data.
///
/// Usage:
/// @code
/// std::array<std::byte, 4096> buffer;
/// auto result = ledger.Edit(buffer);
/// if (result.ok()) {
///   auto& editor = result.value();
///   editor.SetBool("enabled", true);
///   editor.SetInt("retry_count", 5);
///   editor.SetString("name", "Terminal-01");
///   auto status = editor.Commit();  // Writes back to ledger
/// }  // If Commit() not called, changes are discarded
/// @endcode
///
/// ## Stack Usage (Embedded Targets)
///
/// LedgerEditor contains a fixed-size properties array that uses approximately
/// 800 bytes on the stack (16 properties × ~48 bytes each). Combined with the
/// caller-provided buffer, total stack usage is:
///
///   ~800 bytes (properties array) + buffer size
///
/// For memory-constrained embedded devices:
/// - Use smaller buffers (256-512 bytes) for simple ledgers
/// - Avoid deeply nested function calls when editing
/// - `kMaxLedgerProperties` limits entries to 16 properties

#include <cstring>
#include <string_view>
#include <utility>

#include "pb_cloud/cbor.h"
#include "pb_cloud/ledger_types.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace pb::cloud {

// Forward declaration
class LedgerHandle;

/// Maximum number of properties in a ledger (practical limit).
/// Keep this small to avoid stack overflow on embedded devices.
inline constexpr size_t kMaxLedgerProperties = 16;

/// Internal representation of a property during editing.
struct PropertyEntry {
  std::string_view key;
  cbor::MajorType type = cbor::MajorType::kSimpleFloat;

  // Value storage (only one is active based on type)
  union {
    bool bool_value;
    int64_t int_value;
    uint64_t uint_value;
    double double_value;
    struct {
      const std::byte* data;
      size_t size;
    } span_value;
  };

  // For simple/float type, this indicates the specific simple value
  uint8_t simple_value = 0;

  bool removed = false;  // Marked for deletion
};

/// Scoped editor for ledger properties.
///
/// Maintains an in-memory representation of the ledger's CBOR map and
/// writes it back on Commit(). Properties are stored in insertion order.
class LedgerEditor {
 public:
  /// Move constructor.
  LedgerEditor(LedgerEditor&& other) noexcept;

  /// Move assignment.
  LedgerEditor& operator=(LedgerEditor&& other) noexcept;

  // Non-copyable
  LedgerEditor(const LedgerEditor&) = delete;
  LedgerEditor& operator=(const LedgerEditor&) = delete;

  ~LedgerEditor() = default;

  /// Set a boolean property.
  ///
  /// @param key Property key
  /// @param value Property value
  /// @return OkStatus on success, ResourceExhausted if too many properties
  pw::Status SetBool(std::string_view key, bool value);

  /// Set a signed integer property.
  ///
  /// @param key Property key
  /// @param value Property value
  /// @return OkStatus on success, ResourceExhausted if too many properties
  pw::Status SetInt(std::string_view key, int64_t value);

  /// Set an unsigned integer property.
  ///
  /// @param key Property key
  /// @param value Property value
  /// @return OkStatus on success, ResourceExhausted if too many properties
  pw::Status SetUint(std::string_view key, uint64_t value);

  /// Set a double-precision float property.
  ///
  /// @param key Property key
  /// @param value Property value
  /// @return OkStatus on success, ResourceExhausted if too many properties
  pw::Status SetDouble(std::string_view key, double value);

  /// Set a string property.
  ///
  /// The string data is copied to the editor's internal buffer.
  /// The key and value must remain valid until Commit() is called.
  ///
  /// @param key Property key
  /// @param value Property value
  /// @return OkStatus on success, ResourceExhausted if too many properties
  ///         or buffer space exhausted
  pw::Status SetString(std::string_view key, std::string_view value);

  /// Set a byte string property.
  ///
  /// The byte data is copied to the editor's internal buffer.
  ///
  /// @param key Property key
  /// @param value Property value
  /// @return OkStatus on success, ResourceExhausted if too many properties
  ///         or buffer space exhausted
  pw::Status SetBytes(std::string_view key, pw::ConstByteSpan value);

  /// Remove a property.
  ///
  /// @param key Property key to remove
  /// @return OkStatus on success (returns OK even if key didn't exist)
  pw::Status Remove(std::string_view key);

  /// Write the modified properties back to the ledger.
  ///
  /// Encodes all properties as CBOR and writes to the underlying ledger.
  /// After Commit(), this editor should not be reused.
  ///
  /// @return OkStatus on success, or error from encoding/writing
  pw::Status Commit();

  /// Get the number of properties (excluding removed ones).
  size_t property_count() const;

 private:
  friend class LedgerHandle;

  /// Private constructor - only LedgerHandle::Edit can create editors.
  LedgerEditor(LedgerHandle* handle, pw::ByteSpan buffer,
               size_t existing_data_size);

  /// Find or create a property entry for the given key.
  pw::Result<PropertyEntry*> FindOrCreate(std::string_view key);

  /// Find an existing property entry.
  PropertyEntry* Find(std::string_view key);

  /// Allocate space in the string/bytes buffer.
  pw::Result<std::byte*> AllocateBuffer(size_t size);

  LedgerHandle* handle_ = nullptr;
  pw::ByteSpan buffer_;

  // Properties array (fixed-size, no heap allocation)
  PropertyEntry properties_[kMaxLedgerProperties];
  size_t property_count_ = 0;

  // Buffer for string/bytes data (uses end of the provided buffer)
  size_t string_buffer_used_ = 0;  // Grows from end of buffer backwards
};

}  // namespace pb::cloud
