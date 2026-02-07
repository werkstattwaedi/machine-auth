// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file types.h
/// @brief Core types for Particle Cloud API.

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "pw_containers/vector.h"
#include "pw_string/string.h"

namespace pb::cloud {

/// Maximum event name length (Particle limit).
inline constexpr size_t kMaxEventNameSize = 64;

/// Maximum event data size (Particle limit).
inline constexpr size_t kMaxEventDataSize = 1024;

/// Event scope - private (to owner) or public (all devices).
enum class EventScope : uint8_t {
  kPrivate,  ///< Only visible to owner's devices
  kPublic,   ///< Visible to all devices
};

/// Acknowledgement mode for publish operations.
enum class AckMode : uint8_t {
  kNoAck,    ///< Fire and forget, no delivery confirmation
  kWithAck,  ///< Wait for cloud acknowledgement
};

/// Content type for event data.
enum class ContentType : int {
  kText = 0,          ///< Plain text (UTF-8)
  kBinary = 42,       ///< Binary data (application/octet-stream)
  kStructured = 65400 ///< Structured data (CBOR/protobuf)
};

/// Cloud variable types (matches Particle Spark_Data_TypeDef).
enum class VariableType : uint8_t {
  kBool = 1,
  kInt = 2,
  kString = 4,
  kDouble = 9,
};

/// Type trait to map C++ types to VariableType.
/// Specializations provided for supported types.
template <typename T>
struct VariableTypeTrait;

template <>
struct VariableTypeTrait<bool> {
  static constexpr VariableType kType = VariableType::kBool;
};

template <>
struct VariableTypeTrait<int> {
  static constexpr VariableType kType = VariableType::kInt;
};

template <>
struct VariableTypeTrait<double> {
  static constexpr VariableType kType = VariableType::kDouble;
};

// String types - Particle expects char* for string variables
// Note: char arrays decay to char* when passed as T*
template <>
struct VariableTypeTrait<char> {
  static constexpr VariableType kType = VariableType::kString;
};

template <>
struct VariableTypeTrait<const char> {
  static constexpr VariableType kType = VariableType::kString;
};

/// Options for publish operations.
struct PublishOptions {
  EventScope scope = EventScope::kPrivate;
  AckMode ack = AckMode::kWithAck;
  ContentType content_type = ContentType::kText;
  int ttl_seconds = 60;
};

/// Received cloud event - OWNS its data (copied from Particle callback buffer).
///
/// Events are self-contained with owning copies of name and data to avoid
/// dangling pointer issues after Particle's callback returns.
struct ReceivedEvent {
  pw::InlineString<kMaxEventNameSize> name;  ///< Owning copy of event name
  pw::Vector<std::byte, kMaxEventDataSize> data;  ///< Owning copy of event data
  ContentType content_type = ContentType::kText;
};

// -- Particle Limits --

/// Maximum number of cloud functions (Particle limit).
inline constexpr size_t kMaxCloudFunctions = 15;

/// Maximum number of cloud variables (Particle limit).
inline constexpr size_t kMaxCloudVariables = 20;

/// Maximum string variable size (Particle limit).
inline constexpr size_t kMaxStringVariableSize = 622;

// -- Cloud Variable Containers --

/// Cloud-readable variable container for scalar types.
///
/// Owns the storage for a cloud-visible variable. The backend registers
/// this with Particle and reads from the internal storage.
///
/// @tparam T Variable type (bool, int, double)
template <typename T>
class CloudVariable {
 public:
  CloudVariable() = default;
  explicit CloudVariable(T initial) : value_(initial) {}

  /// Set the variable value.
  void Set(T value) { value_ = value; }

  /// Get the current value.
  T Get() const { return value_; }

  /// Implicit conversion to T for reading.
  operator T() const { return value_; }

  /// Assignment operator for convenience.
  CloudVariable& operator=(T value) {
    value_ = value;
    return *this;
  }

  /// Get pointer to internal storage (for Particle API).
  const void* data() const { return &value_; }

  /// Get the VariableType for this variable.
  static constexpr VariableType type() { return VariableTypeTrait<T>::kType; }

 private:
  T value_{};
};

/// Cloud-readable string variable container.
///
/// Owns a fixed-size buffer for string data. Particle reads from this buffer.
///
/// @tparam kMaxSize Maximum string length (default: Particle max of 622)
template <size_t kMaxSize = kMaxStringVariableSize>
class CloudStringVariable {
 public:
  CloudStringVariable() { buffer_[0] = '\0'; }

  explicit CloudStringVariable(std::string_view initial) { Set(initial); }

  /// Set the string value (truncated if too long).
  void Set(std::string_view value) {
    size_t len = std::min(value.size(), kMaxSize - 1);
    std::memcpy(buffer_, value.data(), len);
    buffer_[len] = '\0';
  }

  /// Get the current string value.
  std::string_view Get() const { return std::string_view(buffer_); }

  /// Implicit conversion to string_view.
  operator std::string_view() const { return Get(); }

  /// Assignment from string_view.
  CloudStringVariable& operator=(std::string_view value) {
    Set(value);
    return *this;
  }

  /// Get pointer to internal buffer (for Particle API).
  const void* data() const { return buffer_; }

  /// Get the VariableType for this variable.
  static constexpr VariableType type() { return VariableType::kString; }

 private:
  char buffer_[kMaxSize]{};
};

}  // namespace pb::cloud
