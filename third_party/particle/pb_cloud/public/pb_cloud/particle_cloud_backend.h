// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file particle_cloud_backend.h
/// @brief Particle Cloud backend singleton for P2 devices.
///
/// Provides a singleton implementation of CloudBackend for Particle devices.
/// Use dependency injection with CloudBackend& for testability.
///
/// Usage:
/// @code
/// // Get the singleton instance
/// auto& cloud = pb::cloud::ParticleCloudBackend::Instance();
///
/// // Pass to components via dependency injection
/// MyComponent component(cloud);  // Takes CloudBackend&
/// @endcode

#include <array>
#include <memory>
#include <string_view>

#include "pb_cloud/cloud_backend.h"
#include "pw_async2/channel.h"
#include "pw_string/string.h"

namespace pb::cloud {

/// Default channel capacity for event buffering.
inline constexpr uint16_t kEventChannelCapacity = 8;

/// Particle Cloud backend implementation using spark_* dynalib.
///
/// This is a singleton - use Instance() to get the single instance.
/// Only one instance is allowed (enforced at compile time via private ctor).
class ParticleCloudBackend : public CloudBackend {
 public:
  /// Get the singleton instance.
  ///
  /// @return Reference to the ParticleCloudBackend instance
  static ParticleCloudBackend& Instance();

  // Non-copyable, non-movable
  ParticleCloudBackend(const ParticleCloudBackend&) = delete;
  ParticleCloudBackend& operator=(const ParticleCloudBackend&) = delete;
  ParticleCloudBackend(ParticleCloudBackend&&) = delete;
  ParticleCloudBackend& operator=(ParticleCloudBackend&&) = delete;

  // -- CloudBackend interface --

  PublishFuture Publish(std::string_view name,
                        pw::ConstByteSpan data,
                        const PublishOptions& options) override;

  EventReceiver Subscribe(std::string_view prefix) override;

  pw::Status RegisterFunction(std::string_view name,
                              CloudFunction&& handler) override;

  // Internal: Access handler for trampoline dispatch. Do not use directly.
  CloudFunction& GetHandler(size_t index) { return function_handlers_[index]; }

 protected:
  pw::Status DoRegisterVariable(
      std::string_view name,
      const void* data,
      VariableType type,
      std::unique_ptr<void, VariableDeleter> storage) override;

 private:
  // Private constructor for singleton pattern
  ParticleCloudBackend();
  ~ParticleCloudBackend();

  EventReceiver CreateSubscriptionReceiver();

  static void OnPublishComplete(int error,
                                const void* data,
                                void* reserved,
                                void* reserved2);

  static void OnEventReceived(const char* event_name, const char* data);

  // Function handlers for cloud function trampolines
  std::array<CloudFunction, kMaxCloudFunctions> function_handlers_{};

  pw::async2::ValueProvider<pw::Status> publish_provider_;

  // Event channel for subscription
  pw::async2::ChannelStorage<ReceivedEvent, kEventChannelCapacity>
      event_channel_storage_;
  pw::async2::SpscChannelHandle<ReceivedEvent> event_channel_handle_;
  pw::async2::Sender<ReceivedEvent> event_sender_;

  pw::InlineString<kMaxEventNameSize> subscription_prefix_;

  // Variable storage (ownership of CloudVariable containers)
  std::array<std::shared_ptr<void>, kMaxCloudVariables> variable_storage_{};
  size_t variable_count_ = 0;

  // Function count (handlers are stored in function_handlers_)
  size_t function_count_ = 0;
};

}  // namespace pb::cloud
