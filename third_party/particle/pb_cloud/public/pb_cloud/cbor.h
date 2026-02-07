// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file cbor.h
/// @brief Minimal CBOR encoder/decoder for Particle ledger compatibility.
///
/// This implements a subset of CBOR sufficient for Particle's ledger format:
/// - Map with text keys
/// - Primitive values: null, bool, int, uint, double, string, bytes
///
/// The encoding matches Particle's Wiring API format (LedgerData).
///
/// @code
/// // Encoding
/// std::array<std::byte, 256> buffer;
/// cbor::Encoder encoder(buffer);
/// encoder.BeginMap(2);
/// encoder.WriteBool("enabled", true);
/// encoder.WriteInt("count", 42);
/// auto data = pw::ConstByteSpan(buffer.data(), encoder.size());
///
/// // Decoding
/// cbor::Decoder decoder(data);
/// auto count = decoder.ReadMapHeader();
/// std::array<char, 32> key_buf;
/// while (decoder.HasNext()) {
///   auto key = decoder.ReadKey(pw::as_writable_bytes(pw::span(key_buf)));
///   if (key.ok() && key.value() == "enabled") {
///     auto val = decoder.ReadBool();
///   }
/// }
/// @endcode

#include <cstddef>
#include <cstdint>
#include <string_view>

#include "pw_bytes/span.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace pb::cloud::cbor {

/// CBOR major types (upper 3 bits of initial byte).
enum class MajorType : uint8_t {
  kUnsignedInt = 0,   // 0x00-0x1f
  kNegativeInt = 1,   // 0x20-0x3f
  kByteString = 2,    // 0x40-0x5f
  kTextString = 3,    // 0x60-0x7f
  kArray = 4,         // 0x80-0x9f
  kMap = 5,           // 0xa0-0xbf
  kTag = 6,           // 0xc0-0xdf
  kSimpleFloat = 7,   // 0xe0-0xff
};

/// Simple values in major type 7.
enum class SimpleValue : uint8_t {
  kFalse = 20,  // 0xf4
  kTrue = 21,   // 0xf5
  kNull = 22,   // 0xf6
  kFloat64 = 27,  // 0xfb (followed by 8-byte IEEE 754)
};

/// CBOR encoder - writes CBOR data to a buffer.
///
/// The encoder writes data sequentially. Call BeginMap() first, then
/// write key-value pairs. Keys are text strings, values can be any
/// supported type.
class Encoder {
 public:
  /// Construct encoder with output buffer.
  explicit Encoder(pw::ByteSpan buffer);

  /// Start a map with a known number of key-value pairs.
  ///
  /// @param count Number of key-value pairs that will follow
  /// @return OkStatus or ResourceExhausted if buffer too small
  pw::Status BeginMap(size_t count);

  /// Write a null value with the given key.
  pw::Status WriteNull(std::string_view key);

  /// Write a boolean value with the given key.
  pw::Status WriteBool(std::string_view key, bool value);

  /// Write a signed integer value with the given key.
  ///
  /// Uses the most compact encoding possible for the value.
  pw::Status WriteInt(std::string_view key, int64_t value);

  /// Write an unsigned integer value with the given key.
  ///
  /// Uses the most compact encoding possible for the value.
  pw::Status WriteUint(std::string_view key, uint64_t value);

  /// Write a double-precision float value with the given key.
  ///
  /// Always uses 8-byte IEEE 754 encoding (0xfb prefix).
  pw::Status WriteDouble(std::string_view key, double value);

  /// Write a text string value with the given key.
  pw::Status WriteString(std::string_view key, std::string_view value);

  /// Write a byte string value with the given key.
  pw::Status WriteBytes(std::string_view key, pw::ConstByteSpan value);

  /// Get the number of bytes written so far.
  size_t size() const { return pos_; }

  /// Get the remaining buffer capacity.
  size_t remaining() const { return buffer_.size() - pos_; }

 private:
  /// Write type header with argument (handles compact encoding).
  pw::Status WriteHeader(MajorType type, uint64_t argument);

  /// Write a text string key.
  pw::Status WriteKey(std::string_view key);

  /// Write raw bytes to buffer.
  pw::Status WriteRaw(const void* data, size_t len);

  pw::ByteSpan buffer_;
  size_t pos_ = 0;
};

/// CBOR decoder - reads CBOR data from a buffer.
///
/// The decoder reads data sequentially. Call ReadMapHeader() first,
/// then iterate through key-value pairs using ReadKey() and the
/// appropriate value reader.
class Decoder {
 public:
  /// Construct decoder with input data.
  explicit Decoder(pw::ConstByteSpan data);

  /// Read the map header and return the number of entries.
  ///
  /// @return Number of key-value pairs in the map, or error
  pw::Result<size_t> ReadMapHeader();

  /// Check if there's more data to read.
  bool HasNext() const { return pos_ < data_.size(); }

  /// Read the next key into the provided buffer.
  ///
  /// @param key_buffer Buffer to receive the key string
  /// @return The key as a string_view into key_buffer, or error
  pw::Result<std::string_view> ReadKey(pw::ByteSpan key_buffer);

  /// Peek at the type of the next value without consuming it.
  ///
  /// @return The major type of the next value, or error if no data
  pw::Result<MajorType> PeekType() const;

  /// Read a boolean value.
  ///
  /// @return The boolean value, or error if type mismatch/data error
  pw::Result<bool> ReadBool();

  /// Read a signed integer value.
  ///
  /// Works for both positive and negative CBOR integers.
  /// @return The integer value, or error if type mismatch/overflow
  pw::Result<int64_t> ReadInt();

  /// Read an unsigned integer value.
  ///
  /// Works for positive CBOR integers only.
  /// @return The integer value, or error if type mismatch/negative
  pw::Result<uint64_t> ReadUint();

  /// Read a double-precision float value.
  ///
  /// Also handles integer values by converting to double.
  /// @return The double value, or error if type mismatch
  pw::Result<double> ReadDouble();

  /// Read a text string value into the provided buffer.
  ///
  /// @param buffer Buffer to receive the string data
  /// @return Number of bytes written to buffer, or error
  pw::Result<size_t> ReadString(pw::ByteSpan buffer);

  /// Read a byte string value into the provided buffer.
  ///
  /// @param buffer Buffer to receive the bytes
  /// @return Number of bytes written to buffer, or error
  pw::Result<size_t> ReadBytes(pw::ByteSpan buffer);

  /// Skip the current value without reading it.
  ///
  /// Useful when looking for a specific key.
  pw::Status SkipValue();

  /// Peek at the length of the next byte string or text string.
  ///
  /// Does not consume any data - position remains unchanged.
  /// Useful for pre-allocating buffers before reading.
  ///
  /// @return The length of the string data, or error if not a string type
  pw::Result<size_t> PeekStringLength() const;

  /// Get the current position in the data.
  size_t position() const { return pos_; }

 private:
  /// Read a type-length header and return the argument value.
  pw::Result<uint64_t> ReadHeader(MajorType expected_type);

  /// Read a type-length header without type checking.
  pw::Result<std::pair<MajorType, uint64_t>> ReadHeaderAny();

  /// Read raw bytes from buffer.
  pw::Status ReadRaw(void* data, size_t len);

  /// Peek at the next byte without consuming it.
  pw::Result<uint8_t> PeekByte() const;

  pw::ConstByteSpan data_;
  size_t pos_ = 0;
};

}  // namespace pb::cloud::cbor
