// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file serializer.h
/// @brief Serializer concept and built-in serializers for cloud events.
///
/// Serializers convert between typed values and byte buffers for cloud
/// transmission. Implement the Serializer trait for custom types.
///
/// Usage:
/// @code
/// // Using built-in string serializer
/// std::string_view message = "hello";
/// std::array<std::byte, 64> buffer;
/// auto size = Serializer<std::string_view>::Serialize(message, buffer);
/// if (size.ok()) {
///   // buffer contains "hello", size.value() == 5
/// }
/// @endcode

#include <cstring>
#include <string_view>

#include "pb_cloud/types.h"
#include "pw_bytes/span.h"
#include "pw_result/result.h"

namespace pb::cloud {

/// Serializer trait template - specialize for custom types.
///
/// A serializer must provide:
/// - static Serialize(const T& value, pw::ByteSpan buffer) -> Result<size_t>
/// - static Deserialize(pw::ConstByteSpan data) -> Result<T>
/// - static constexpr ContentType kContentType
///
/// @tparam T The type to serialize/deserialize
template <typename T>
struct Serializer;  // Primary template (undefined - must specialize)

/// Built-in serializer for string_view.
///
/// Simply copies the string bytes without null terminator.
template <>
struct Serializer<std::string_view> {
  /// Serialize string to buffer.
  /// @param value String to serialize
  /// @param buffer Output buffer
  /// @return Number of bytes written, or ResourceExhausted if buffer too small
  static pw::Result<size_t> Serialize(std::string_view value,
                                      pw::ByteSpan buffer) {
    if (buffer.size() < value.size()) {
      return pw::Status::ResourceExhausted();
    }
    std::memcpy(buffer.data(), value.data(), value.size());
    return value.size();
  }

  /// Deserialize bytes to string_view.
  /// @param data Input bytes
  /// @return String view of the data (points into original buffer)
  static pw::Result<std::string_view> Deserialize(pw::ConstByteSpan data) {
    // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
    return std::string_view(reinterpret_cast<const char*>(data.data()),
                            data.size());
  }

  /// Content type for string serialization.
  static constexpr ContentType kContentType = ContentType::kText;
};

/// Built-in serializer for raw byte spans (identity transform).
///
/// Useful when data is already in binary format.
template <>
struct Serializer<pw::ConstByteSpan> {
  /// Serialize bytes to buffer (copy).
  /// @param value Bytes to serialize
  /// @param buffer Output buffer
  /// @return Number of bytes written, or ResourceExhausted if buffer too small
  static pw::Result<size_t> Serialize(pw::ConstByteSpan value,
                                      pw::ByteSpan buffer) {
    if (buffer.size() < value.size()) {
      return pw::Status::ResourceExhausted();
    }
    std::memcpy(buffer.data(), value.data(), value.size());
    return value.size();
  }

  /// Deserialize bytes (returns span pointing to input).
  /// @param data Input bytes
  /// @return Same span (no transformation)
  static pw::Result<pw::ConstByteSpan> Deserialize(pw::ConstByteSpan data) {
    return data;
  }

  /// Content type for binary serialization.
  static constexpr ContentType kContentType = ContentType::kBinary;
};

}  // namespace pb::cloud
