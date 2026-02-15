// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file typed_api.h
/// @brief Typed API for publishing cloud events with automatic serialization.
///
/// These functions handle serialization and publishing in one call, returning
/// a future for async completion tracking.
///
/// Usage:
/// @code
/// // Publish a string (uses Serializer<std::string_view>)
/// auto future = PublishTyped(cloud, "device/status", std::string_view("online"));
///
/// // Publish a protobuf message (nanopb struct)
/// maco_proto_particle_DeviceConfig config = {};
/// auto future = PublishProto<maco_proto_particle_DeviceConfig>(
///     cloud, "sensor/reading", config);
///
/// // Poll the future in async loop
/// auto poll = future.Pend(cx);
/// if (poll.IsReady()) {
///   if (!poll.value().ok()) {
///     PW_LOG_ERROR("Publish failed");
///   }
/// }
/// @endcode

#include <array>
#include <string_view>

#include "pb_cloud/cloud_backend.h"
#include "pb_cloud/proto_serializer.h"
#include "pb_cloud/serializer.h"
#include "pb_cloud/types.h"

namespace pb::cloud {

/// Publish typed value using the specified serializer.
///
/// Serializes the value to a temporary buffer, then publishes via the cloud
/// backend. The buffer is copied internally by the backend.
///
/// @tparam T Value type to publish
/// @tparam Ser Serializer to use (defaults to Serializer<T>)
/// @tparam kBufSize Serialization buffer size (default 256)
/// @param cloud Cloud backend to use
/// @param name Event name
/// @param value Value to serialize and publish
/// @param options Publish options (optional)
/// @return Future that resolves when publish completes
template <typename T,
          typename Ser = Serializer<T>,
          size_t kBufSize = 256>
PublishFuture PublishTyped(CloudBackend& cloud,
                           std::string_view name,
                           const T& value,
                           const PublishOptions& options = {}) {
  std::array<std::byte, kBufSize> buffer;
  auto result = Ser::Serialize(value, buffer);
  if (!result.ok()) {
    // Return immediately-failed future
    // Note: We need to create a provider and immediately set it
    return cloud.Publish(name, pw::ConstByteSpan(), options);
  }

  PublishOptions opts = options;
  opts.content_type = Ser::kContentType;
  return cloud.Publish(
      name, pw::ConstByteSpan(buffer.data(), result.value()), opts);
}

/// Publish a protobuf message.
///
/// Convenience wrapper around PublishTyped using ProtoSerializer.
/// T is the nanopb message struct type (must have NanopbFields<T> specialized).
///
/// @tparam T Nanopb message struct type
/// @tparam kBufSize Serialization buffer size (default 256)
/// @param cloud Cloud backend to use
/// @param name Event name
/// @param message Message to serialize and publish
/// @param options Publish options (optional)
/// @return Future that resolves when publish completes
template <typename T, size_t kBufSize = 256>
PublishFuture PublishProto(CloudBackend& cloud,
                           std::string_view name,
                           const T& message,
                           const PublishOptions& options = {}) {
  return PublishTyped<T, ProtoSerializer<T>, kBufSize>(
      cloud, name, message, options);
}

/// Deserialize a received event to a typed value.
///
/// Utility function for handling received events.
///
/// @tparam T Target type
/// @tparam Ser Serializer to use (defaults to Serializer<T>)
/// @param event Received event
/// @return Deserialized value, or error
template <typename T, typename Ser = Serializer<T>>
pw::Result<T> DeserializeEvent(const ReceivedEvent& event) {
  return Ser::Deserialize(
      pw::ConstByteSpan(event.data.data(), event.data.size()));
}

/// Deserialize a received event to a protobuf message.
///
/// Convenience wrapper for nanopb protobuf deserialization.
/// T is the nanopb message struct type (must have NanopbFields<T> specialized).
///
/// @tparam T Nanopb message struct type
/// @param event Received event
/// @return Deserialized message, or error
template <typename T>
pw::Result<T> DeserializeProtoEvent(const ReceivedEvent& event) {
  return DeserializeEvent<T, ProtoSerializer<T>>(event);
}

}  // namespace pb::cloud
