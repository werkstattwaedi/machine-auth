// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file cloud_backend.h
/// @brief Abstract cloud backend interface for Particle Cloud API.
///
/// Provides dependency-injectable interface for cloud operations:
/// - Production: ParticleCloudBackend (spark_* dynalib)
/// - Testing: MockCloudBackend (simulated events)
///
/// Usage (dependency injection):
/// @code
/// class MyComponent {
///  public:
///   explicit MyComponent(pb::cloud::CloudBackend& cloud) : cloud_(cloud) {}
///
///   void PublishStatus() {
///     auto future = cloud_.Publish("device/status", data, {});
///     // Poll future in async loop...
///   }
///
///  private:
///   pb::cloud::CloudBackend& cloud_;
/// };
///
/// // Application wiring:
/// ParticleCloudBackend cloud;  // or MockCloudBackend in tests
/// MyComponent component(cloud);
/// @endcode

#include <memory>
#include <string_view>

#include "pb_cloud/types.h"
#include "pw_assert/check.h"
#include "pw_async2/channel.h"
#include "pw_async2/value_future.h"
#include "pw_bytes/span.h"
#include "pw_function/function.h"
#include "pw_status/status.h"

namespace pb::cloud {

/// Future type for publish completion.
/// Resolves to pw::Status indicating success or failure.
using PublishFuture = pw::async2::ValueFuture<pw::Status>;

/// Receiver for cloud events (from Channel).
/// Call receiver.Receive() to get a future that resolves to the next event.
using EventReceiver = pw::async2::Receiver<ReceivedEvent>;

/// Sender for cloud events (used internally by backends).
using EventSender = pw::async2::Sender<ReceivedEvent>;

/// Abstract cloud backend interface.
///
/// Implementations:
/// - ParticleCloudBackend: Real implementation using spark_* dynalib
/// - MockCloudBackend: Mock for testing and simulation
class CloudBackend {
 public:
  virtual ~CloudBackend() = default;

  // -- Publishing --

  /// Publish event data to cloud. Returns future that completes when ack'd.
  ///
  /// Note: data is copied internally - caller's buffer can be freed after call.
  ///
  /// @param name Event name (max 64 chars)
  /// @param data Binary payload (will be copied)
  /// @param options Publish options (scope, ack, content_type, ttl)
  /// @return Future that resolves to Status when publish completes
  virtual PublishFuture Publish(std::string_view name,
                                pw::ConstByteSpan data,
                                const PublishOptions& options) = 0;

  // -- Subscription --

  /// Subscribe to cloud events matching prefix.
  ///
  /// Returns a Receiver channel handle - caller polls it to receive events.
  /// Events are buffered in the channel; no lost events between polls.
  ///
  /// Usage:
  /// @code
  /// auto receiver = backend.Subscribe("device/command");
  /// // In async loop:
  /// auto future = receiver.Receive();
  /// auto poll = future.Pend(cx);
  /// if (poll.IsReady()) {
  ///   if (poll.value().has_value()) {
  ///     HandleEvent(poll.value().value());
  ///   } else {
  ///     // Channel closed
  ///   }
  /// }
  /// @endcode
  ///
  /// @param prefix Event name prefix to match (e.g., "device/" matches
  ///               "device/command", "device/config", etc.)
  /// @return Receiver handle for receiving events
  virtual EventReceiver Subscribe(std::string_view prefix) = 0;

  // -- Variables --

  /// Register a cloud-readable variable.
  ///
  /// Creates and registers a variable with the cloud. The backend owns the
  /// storage. Returns a reference for updating the value.
  ///
  /// Crashes (via PW_CHECK) if registration fails (e.g., max variables reached).
  /// This is a programmer error - register variables at startup within limits.
  ///
  /// @tparam T Variable type (bool, int, double)
  /// @param name Variable name (max 64 chars)
  /// @param initial Initial value
  /// @return Reference to the stored variable for updating
  ///
  /// Usage:
  /// @code
  /// auto& temp = cloud.RegisterVariable("temperature", 25);
  /// temp.Set(30);  // Update the cloud-visible value
  /// @endcode
  template <typename T>
  CloudVariable<T>& RegisterVariable(std::string_view name, T initial = T{}) {
    auto var = std::make_unique<CloudVariable<T>>(initial);
    CloudVariable<T>* ptr = var.get();
    pw::Status status = DoRegisterVariable(
        name, var->data(), CloudVariable<T>::type(), EraseType(std::move(var)));
    PW_CHECK_OK(status, "Failed to register variable");
    return *ptr;
  }

  /// Register a cloud-readable string variable.
  ///
  /// Crashes (via PW_CHECK) if registration fails (e.g., max variables reached).
  ///
  /// @tparam kMaxSize Maximum string size (default: Particle max of 622)
  /// @param name Variable name (max 64 chars)
  /// @param initial Initial string value
  /// @return Reference to the stored variable for updating
  ///
  /// Usage:
  /// @code
  /// auto& status = cloud.RegisterStringVariable("status", "ready");
  /// status.Set("busy");
  /// @endcode
  template <size_t kMaxSize = kMaxStringVariableSize>
  CloudStringVariable<kMaxSize>& RegisterStringVariable(
      std::string_view name,
      std::string_view initial = "") {
    auto var = std::make_unique<CloudStringVariable<kMaxSize>>(initial);
    CloudStringVariable<kMaxSize>* ptr = var.get();
    pw::Status status = DoRegisterVariable(
        name, var->data(), VariableType::kString, EraseType(std::move(var)));
    PW_CHECK_OK(status, "Failed to register string variable");
    return *ptr;
  }

  // -- Functions --

  /// Cloud function callback type.
  /// Uses pw::Function to support lambdas, captures, and member functions.
  /// @param arg String argument from cloud caller
  /// @return Integer result (0 typically means success)
  using CloudFunction = pw::Function<int(std::string_view arg)>;

  /// Register a cloud-callable function.
  ///
  /// The function can be called from the Particle Console or API.
  /// Supports any callable: lambdas, function pointers, member functions.
  ///
  /// Takes handler by rvalue reference to make ownership transfer explicit.
  /// Caller must use std::move() for lvalue handlers.
  ///
  /// @param name Function name (max 64 chars)
  /// @param handler Callable to invoke when function is called from cloud
  /// @return OkStatus on success, ResourceExhausted if max functions reached
  ///
  /// Usage:
  /// @code
  /// // Lambda with capture
  /// cloud.RegisterFunction("setMode", [this](std::string_view arg) {
  ///   if (arg == "active") { SetActive(); return 0; }
  ///   return -1;
  /// });
  ///
  /// // Free function
  /// cloud.RegisterFunction("reset", [](std::string_view) {
  ///   Reset();
  ///   return 0;
  /// });
  /// @endcode
  virtual pw::Status RegisterFunction(std::string_view name,
                                      CloudFunction&& handler) = 0;

 protected:
  // -- Implementation hooks for backends --

  /// Type-erased deleter for variable storage.
  using VariableDeleter = void (*)(void*);

  /// Backend implementation for variable registration.
  /// @param name Variable name
  /// @param data Pointer to variable data (for Particle API)
  /// @param type Variable type
  /// @param storage Ownership of the variable container (type-erased)
  /// @return OkStatus on success, ResourceExhausted if max variables reached
  virtual pw::Status DoRegisterVariable(
      std::string_view name,
      const void* data,
      VariableType type,
      std::unique_ptr<void, VariableDeleter> storage) = 0;

  /// Helper to create type-erased storage from unique_ptr.
  template <typename T>
  static std::unique_ptr<void, VariableDeleter> EraseType(
      std::unique_ptr<T> ptr) {
    return std::unique_ptr<void, VariableDeleter>(
        ptr.release(), [](void* p) { delete static_cast<T*>(p); });
  }
};

}  // namespace pb::cloud
