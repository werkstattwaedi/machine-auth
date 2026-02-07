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
/// // Read a protobuf message from ledger
/// auto result = ReadLedgerProto<Config>(backend, "device-config");
/// if (result.ok()) {
///   Config::Message config = result.value();
///   // Use config...
/// }
///
/// // Write a protobuf message to ledger
/// Config::Message config{.setting = 42};
/// auto status = WriteLedgerProto<Config>(backend, "device-config", config);
/// @endcode

#include <array>
#include <string_view>

#include "pb_cloud/ledger_backend.h"
#include "pb_cloud/proto_serializer.h"
#include "pb_cloud/serializer.h"
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

/// Read a protobuf message from a ledger.
///
/// Convenience wrapper around ReadLedger using ProtoSerializer.
///
/// @tparam Proto Proto type (e.g., Config from config.pwpb.h)
/// @tparam kBufSize Read buffer size (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param name Ledger name
/// @return Decoded message, or error
template <typename Proto, size_t kBufSize = 1024>
pw::Result<typename Proto::Message> ReadLedgerProto(LedgerBackend& backend,
                                                    std::string_view name) {
  return ReadLedger<typename Proto::Message, ProtoSerializer<Proto>, kBufSize>(
      backend, name);
}

/// Write a protobuf message to a ledger.
///
/// Convenience wrapper around WriteLedger using ProtoSerializer.
///
/// @tparam Proto Proto type (e.g., Config from config.pwpb.h)
/// @tparam kBufSize Serialization buffer size (default 1024 bytes)
/// @param backend Ledger backend to use
/// @param name Ledger name
/// @param message Message to serialize and write
/// @return OkStatus on success, or error
template <typename Proto, size_t kBufSize = 1024>
pw::Status WriteLedgerProto(LedgerBackend& backend,
                            std::string_view name,
                            const typename Proto::Message& message) {
  return WriteLedger<typename Proto::Message, ProtoSerializer<Proto>, kBufSize>(
      backend, name, message);
}

}  // namespace pb::cloud
