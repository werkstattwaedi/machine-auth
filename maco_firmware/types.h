// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file types.h
/// @brief Domain types for the MACO firmware.
///
/// These types provide type-safe wrappers for common identifiers used
/// throughout the firmware. They decouple the API from protobuf format
/// and provide validation at construction time.

#include <array>
#include <cstddef>

#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_string/string.h"

namespace maco {

/// 7-byte NFC tag unique identifier (NTAG 424 DNA).
class TagUid {
 public:
  static constexpr size_t kSize = 7;

  /// Create from bytes (must be exactly 7 bytes).
  static pw::Result<TagUid> FromBytes(pw::ConstByteSpan bytes) {
    if (bytes.size() != kSize) {
      return pw::Status::InvalidArgument();
    }
    std::array<std::byte, kSize> arr;
    std::copy(bytes.begin(), bytes.end(), arr.begin());
    return TagUid(arr);
  }

  /// Create from a std::array directly.
  static TagUid FromArray(std::array<std::byte, kSize> value) {
    return TagUid(value);
  }

  /// Access the underlying bytes.
  pw::ConstByteSpan bytes() const {
    return pw::ConstByteSpan(value_.data(), value_.size());
  }

  /// Access the raw array.
  const std::array<std::byte, kSize>& array() const { return value_; }

  bool operator==(const TagUid& other) const = default;

 private:
  explicit TagUid(std::array<std::byte, kSize> value) : value_(value) {}
  std::array<std::byte, kSize> value_;
};

/// 20-character Firebase document ID.
class FirebaseId {
 public:
  static constexpr size_t kMaxSize = 20;

  /// Create from a string view (must be <= 20 characters).
  static pw::Result<FirebaseId> FromString(std::string_view str) {
    if (str.size() > kMaxSize) {
      return pw::Status::InvalidArgument();
    }
    return FirebaseId(pw::InlineString<kMaxSize>(str));
  }

  /// Create an empty FirebaseId.
  static FirebaseId Empty() { return FirebaseId(pw::InlineString<kMaxSize>()); }

  /// Access the string value.
  std::string_view value() const { return std::string_view(value_); }

  /// Check if empty.
  bool empty() const { return value_.empty(); }

  bool operator==(const FirebaseId& other) const = default;

 private:
  explicit FirebaseId(pw::InlineString<kMaxSize> value) : value_(value) {}
  pw::InlineString<kMaxSize> value_;
};

/// 12-byte device identifier (P2 hardware ID).
class DeviceId {
 public:
  static constexpr size_t kSize = 12;

  /// Create from bytes (must be exactly 12 bytes).
  static pw::Result<DeviceId> FromBytes(pw::ConstByteSpan bytes) {
    if (bytes.size() != kSize) {
      return pw::Status::InvalidArgument();
    }
    std::array<std::byte, kSize> arr;
    std::copy(bytes.begin(), bytes.end(), arr.begin());
    return DeviceId(arr);
  }

  /// Create from a std::array directly.
  static constexpr DeviceId FromArray(std::array<std::byte, kSize> value) {
    return DeviceId(value);
  }

  /// Access the underlying bytes.
  pw::ConstByteSpan bytes() const {
    return pw::ConstByteSpan(value_.data(), value_.size());
  }

  /// Access the raw array.
  constexpr const std::array<std::byte, kSize>& array() const {
    return value_;
  }

  bool operator==(const DeviceId& other) const = default;

 private:
  explicit constexpr DeviceId(std::array<std::byte, kSize> value)
      : value_(value) {}
  std::array<std::byte, kSize> value_;
};

/// 16-byte AES-128 key.
class KeyBytes {
 public:
  static constexpr size_t kSize = 16;

  /// Create from bytes (must be exactly 16 bytes).
  static pw::Result<KeyBytes> FromBytes(pw::ConstByteSpan bytes) {
    if (bytes.size() != kSize) {
      return pw::Status::InvalidArgument();
    }
    std::array<std::byte, kSize> arr;
    std::copy(bytes.begin(), bytes.end(), arr.begin());
    return KeyBytes(arr);
  }

  /// Create from a std::array directly.
  static KeyBytes FromArray(std::array<std::byte, kSize> value) {
    return KeyBytes(value);
  }

  /// Access the underlying bytes.
  pw::ConstByteSpan bytes() const {
    return pw::ConstByteSpan(value_.data(), value_.size());
  }

  /// Access the raw array.
  const std::array<std::byte, kSize>& array() const { return value_; }

  bool operator==(const KeyBytes& other) const = default;

 private:
  explicit KeyBytes(std::array<std::byte, kSize> value) : value_(value) {}
  std::array<std::byte, kSize> value_;
};

}  // namespace maco
