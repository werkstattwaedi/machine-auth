// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file ledger_typed_api.h
/// @brief Typed API for reading/writing ledgers with automatic serialization.
///
/// These functions handle serialization and ledger I/O in one call.
///
/// Usage:
/// @code
/// // Read a protobuf message from raw ledger bytes
/// auto result = ReadLedgerProto<MyConfig>(backend, "device-config");
///
/// // Read protobuf from a CBOR string property (base64-encoded)
/// auto result = ReadLedgerProtoB64<MyConfig>(
///     backend, "terminal-config", "device_config.proto.b64");
///
/// // Write protobuf as a base64 CBOR property
/// MyConfig config = MyConfig_init_zero;
/// auto status = WriteLedgerProtoB64(
///     backend, "terminal-config", "device_config.proto.b64", config);
/// @endcode

#include <array>
#include <string_view>

#include "pb_cloud/ledger_backend.h"
#include "pb_cloud/proto_serializer.h"
#include "pb_cloud/serializer.h"
#include "pw_base64/base64.h"
#include "pw_result/result.h"
#include "pw_status/status.h"

namespace pb::cloud {

/// Read a typed value from a ledger using the specified serializer.
///
/// Gets ledger handle, reads data, and deserializes in one operation.
///
/// @tparam T Value type to read
/// @tparam Ser Serializer to use (defaults to Serializer<T>)
/// @tparam kBufSize Read buffer size (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param name Ledger name
/// @return Deserialized value, or error
template <typename T, typename Ser = Serializer<T>, size_t kBufSize = 1024>
pw::Result<T> ReadLedger(LedgerBackend& backend, std::string_view name) {
  auto ledger_result = backend.GetLedger(name);
  if (!ledger_result.ok()) {
    return ledger_result.status();
  }

  std::array<std::byte, kBufSize> buffer;
  auto read_result = ledger_result.value().Read(buffer);
  if (!read_result.ok()) {
    return read_result.status();
  }

  return Ser::Deserialize(
      pw::ConstByteSpan(buffer.data(), read_result.value()));
}

/// Write a typed value to a ledger using the specified serializer.
///
/// Serializes value, gets ledger handle, and writes in one operation.
///
/// @tparam T Value type to write
/// @tparam Ser Serializer to use (defaults to Serializer<T>)
/// @tparam kBufSize Serialization buffer size (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param name Ledger name
/// @param value Value to serialize and write
/// @return OkStatus on success, or error
template <typename T, typename Ser = Serializer<T>, size_t kBufSize = 1024>
pw::Status WriteLedger(LedgerBackend& backend,
                       std::string_view name,
                       const T& value) {
  std::array<std::byte, kBufSize> buffer;
  auto serialize_result = Ser::Serialize(value, buffer);
  if (!serialize_result.ok()) {
    return serialize_result.status();
  }

  auto ledger_result = backend.GetLedger(name);
  if (!ledger_result.ok()) {
    return ledger_result.status();
  }

  return ledger_result.value().Write(
      pw::ConstByteSpan(buffer.data(), serialize_result.value()));
}

/// Read a protobuf message from raw ledger bytes.
///
/// Convenience wrapper around ReadLedger using ProtoSerializer.
/// T is the nanopb message struct type (must have NanopbFields<T> specialized).
///
/// @tparam T Nanopb message struct type
/// @tparam kBufSize Read buffer size (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param name Ledger name
/// @return Decoded message, or error
template <typename T, size_t kBufSize = 1024>
pw::Result<T> ReadLedgerProto(LedgerBackend& backend, std::string_view name) {
  return ReadLedger<T, ProtoSerializer<T>, kBufSize>(backend, name);
}

/// Write a protobuf message as raw ledger bytes.
///
/// Convenience wrapper around WriteLedger using ProtoSerializer.
/// T is the nanopb message struct type (must have NanopbFields<T> specialized).
///
/// @tparam T Nanopb message struct type
/// @tparam kBufSize Serialization buffer size (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param name Ledger name
/// @param message Message to serialize and write
/// @return OkStatus on success, or error
template <typename T, size_t kBufSize = 1024>
pw::Status WriteLedgerProto(LedgerBackend& backend,
                            std::string_view name,
                            const T& message) {
  return WriteLedger<T, ProtoSerializer<T>, kBufSize>(backend, name, message);
}

/// Read a base64-encoded protobuf from a CBOR string property.
///
/// The ledger stores CBOR-encoded data (required by Particle Device OS).
/// This reads a specific string property containing base64-encoded protobuf,
/// decodes the base64, and deserializes the protobuf.
///
/// @tparam T Nanopb message struct type (must have NanopbFields<T> specialized)
/// @tparam kBufSize Buffer size for base64 string (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param ledger_name Ledger name (e.g., "terminal-config")
/// @param key CBOR property key (e.g., "device_config.proto.b64")
/// @return Decoded message, or error
template <typename T, size_t kBufSize = 1024>
pw::Result<T> ReadLedgerProtoB64(LedgerBackend& backend,
                                  std::string_view ledger_name,
                                  std::string_view key) {
  auto ledger_result = backend.GetLedger(ledger_name);
  if (!ledger_result.ok()) {
    return ledger_result.status();
  }

  // Read base64 string from CBOR property
  std::array<std::byte, kBufSize> buffer;
  auto str_result = ledger_result.value().GetString(key, buffer);
  if (!str_result.ok()) {
    return str_result.status();
  }
  size_t b64_len = str_result.value();

  // Validate base64
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  if (!pw_Base64IsValid(reinterpret_cast<const char*>(buffer.data()),
                        b64_len)) {
    return pw::Status::DataLoss();
  }

  // Decode base64 in-place (decoded is always smaller than encoded)
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  size_t decoded_size = pw_Base64Decode(
      reinterpret_cast<const char*>(buffer.data()), b64_len, buffer.data());

  // Deserialize protobuf
  return ProtoSerializer<T>::Deserialize(
      pw::ConstByteSpan(buffer.data(), decoded_size));
}

/// Write a protobuf message as a base64-encoded CBOR string property.
///
/// Serializes the protobuf, base64-encodes it, and stores it as a string
/// property in the ledger's CBOR data. This format is compatible with
/// Particle Cloud REST API (JSON → CBOR on device).
///
/// @tparam T Nanopb message struct type (must have NanopbFields<T> specialized)
/// @tparam kBufSize Proto serialization buffer size (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param ledger_name Ledger name (e.g., "terminal-config")
/// @param key CBOR property key (e.g., "device_config.proto.b64")
/// @param message Message to serialize and write
/// @return OkStatus on success, or error
template <typename T, size_t kBufSize = 1024>
pw::Status WriteLedgerProtoB64(LedgerBackend& backend,
                                std::string_view ledger_name,
                                std::string_view key,
                                const T& message) {
  // Serialize proto
  std::array<std::byte, kBufSize> buffer;
  auto ser_result = ProtoSerializer<T>::Serialize(message, buffer);
  if (!ser_result.ok()) {
    return ser_result.status();
  }
  size_t proto_size = ser_result.value();

  // Encode to base64
  constexpr size_t kMaxB64Size = PW_BASE64_ENCODED_SIZE(kBufSize);
  std::array<char, kMaxB64Size> b64_buffer;
  pw_Base64Encode(buffer.data(), proto_size, b64_buffer.data());
  size_t b64_len = PW_BASE64_ENCODED_SIZE(proto_size);

  // Write as CBOR string property
  auto ledger_result = backend.GetLedger(ledger_name);
  if (!ledger_result.ok()) {
    return ledger_result.status();
  }

  // Reuse proto buffer as edit working buffer (proto serialization is done)
  auto editor_result = ledger_result.value().Edit(buffer);
  if (!editor_result.ok()) {
    return editor_result.status();
  }

  auto status = editor_result.value().SetString(
      key, std::string_view(b64_buffer.data(), b64_len));
  if (!status.ok()) {
    return status;
  }

  return editor_result.value().Commit();
}

}  // namespace pb::cloud
