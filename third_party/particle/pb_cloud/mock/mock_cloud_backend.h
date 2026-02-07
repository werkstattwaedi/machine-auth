// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

/// @file mock_cloud_backend.h
/// @brief Mock cloud backend for testing.
///
/// Provides simulation helpers to inject events and control publish outcomes.
///
/// Usage (dependency injection):
/// @code
/// MockCloudBackend mock;
///
/// // Register a variable
/// auto& temp = mock.RegisterVariable("temp", 25);
/// temp.Set(30);
///
/// // Register a function
/// mock.RegisterFunction("cmd", [](std::string_view arg) { return 0; });
///
/// // Simulate a function call from cloud
/// int result = mock.CallFunction("cmd", "test_arg");
///
/// // Verify what was published
/// auto future = mock.Publish("test", data, {});
/// EXPECT_EQ(mock.last_published().name, "test");
/// mock.SimulatePublishSuccess();
/// @endcode

#include <array>
#include <cstring>

#include "pb_cloud/cloud_backend.h"
#include "pw_assert/check.h"

namespace pb::cloud {

/// Default channel capacity for mock event buffering.
inline constexpr uint16_t kMockEventChannelCapacity = 8;

/// Mock cloud backend for testing.
///
/// Follows the MockNfcReader pattern with:
/// - Interface implementation
/// - Simulation helpers
/// - Test inspection methods
class MockCloudBackend : public CloudBackend {
 public:
  MockCloudBackend() = default;

  // -- CloudBackend Interface --

  PublishFuture Publish(std::string_view name,
                        pw::ConstByteSpan data,
                        const PublishOptions& options) override {
    // Record the publish
    last_published_.name = pw::InlineString<kMaxEventNameSize>(name);
    size_t copy_len = std::min(data.size(), last_published_.data.max_size());
    last_published_.data.resize(copy_len);
    std::memcpy(last_published_.data.data(), data.data(), copy_len);
    last_published_.options = options;
    ++publish_count_;

    return publish_provider_.Get();
  }

  EventReceiver Subscribe(std::string_view prefix) override {
    subscription_prefix_ = pw::InlineString<kMaxEventNameSize>(prefix);
    return CreateSubscriptionReceiver();
  }

  pw::Status RegisterFunction(std::string_view name,
                              CloudFunction&& handler) override {
    PW_CHECK(function_count_ < kMaxCloudFunctions,
             "Max cloud functions (%zu) exceeded", kMaxCloudFunctions);

    functions_[function_count_].name = pw::InlineString<kMaxEventNameSize>(name);
    functions_[function_count_].handler = std::move(handler);
    ++function_count_;
    return pw::OkStatus();
  }

  // -- Simulation Helpers --

  /// Complete the pending publish with success.
  void SimulatePublishSuccess() { publish_provider_.Resolve(pw::OkStatus()); }

  /// Complete the pending publish with error.
  void SimulatePublishFailure(pw::Status error) {
    publish_provider_.Resolve(error);
  }

  /// Inject a received event into the subscription channel.
  /// Event is buffered and delivered when consumer polls.
  void SimulateEventReceived(std::string_view name,
                             pw::ConstByteSpan data,
                             ContentType type = ContentType::kText) {
    ReceivedEvent event;
    event.name = pw::InlineString<kMaxEventNameSize>(name);
    size_t copy_len = std::min(data.size(), event.data.max_size());
    event.data.resize(copy_len);
    std::memcpy(event.data.data(), data.data(), copy_len);
    event.content_type = type;

    // Send via the sender (will be buffered in channel)
    if (event_sender_.is_open()) {
      (void)event_sender_.TrySend(std::move(event));
    }
  }

  /// Close the subscription channel (simulates disconnect).
  void CloseSubscription() { event_sender_.Disconnect(); }

  /// Call a registered function (simulates cloud invocation).
  /// @param name Function name
  /// @param arg Argument to pass
  /// @return Function result, or -1 if function not found
  int CallFunction(std::string_view name, std::string_view arg) {
    for (size_t i = 0; i < function_count_; ++i) {
      if (std::string_view(functions_[i].name) == name &&
          functions_[i].handler) {
        return functions_[i].handler(arg);
      }
    }
    return -1;  // Function not found
  }

  // -- Test Inspection --

  /// Published event details.
  struct PublishedEvent {
    pw::InlineString<kMaxEventNameSize> name;
    pw::Vector<std::byte, kMaxEventDataSize> data;
    PublishOptions options;
  };

  /// Get the last published event.
  const PublishedEvent& last_published() const { return last_published_; }

  /// Get the count of publish calls.
  size_t publish_count() const { return publish_count_; }

  /// Get the current subscription prefix.
  std::string_view subscription_prefix() const {
    return std::string_view(subscription_prefix_);
  }

  /// Registered variable details.
  struct RegisteredVariable {
    pw::InlineString<kMaxEventNameSize> name;
    const void* data;
    VariableType type;

    RegisteredVariable() : data(nullptr), type(VariableType::kInt) {}
  };

  /// Get the last registered variable.
  const RegisteredVariable& last_variable() const {
    return variable_count_ > 0 ? variables_[variable_count_ - 1]
                               : empty_variable_;
  }

  /// Get the count of variable registrations.
  size_t variable_count() const { return variable_count_; }

  /// Registered function details.
  struct RegisteredFunction {
    pw::InlineString<kMaxEventNameSize> name;
    CloudFunction handler;
  };

  /// Get the last registered function.
  const RegisteredFunction& last_function() const {
    return function_count_ > 0 ? functions_[function_count_ - 1]
                               : empty_function_;
  }

  /// Get the count of function registrations.
  size_t function_count() const { return function_count_; }

  /// Reset all state (for test isolation).
  void Reset() {
    last_published_.name.clear();
    last_published_.data.clear();
    last_published_.options = PublishOptions{};
    publish_count_ = 0;
    subscription_prefix_.clear();

    // Clear variables
    for (size_t i = 0; i < variable_count_; ++i) {
      variables_[i].name.clear();
      variables_[i].data = nullptr;
      variables_[i].type = VariableType::kInt;
      variable_storage_[i].reset();
    }
    variable_count_ = 0;

    // Clear functions
    for (size_t i = 0; i < function_count_; ++i) {
      functions_[i].name.clear();
      functions_[i].handler = nullptr;
    }
    function_count_ = 0;

    // Reset channel
    if (event_sender_.is_open()) {
      event_sender_.Disconnect();
    }
    event_channel_handle_ = {};
  }

 protected:
  pw::Status DoRegisterVariable(
      std::string_view name,
      const void* data,
      VariableType type,
      std::unique_ptr<void, VariableDeleter> storage) override {
    if (variable_count_ >= kMaxCloudVariables) {
      return pw::Status::ResourceExhausted();
    }

    variables_[variable_count_].name = pw::InlineString<kMaxEventNameSize>(name);
    variables_[variable_count_].data = data;
    variables_[variable_count_].type = type;
    // Convert unique_ptr to shared_ptr for easier storage
    variable_storage_[variable_count_] =
        std::shared_ptr<void>(storage.release(), storage.get_deleter());
    ++variable_count_;
    return pw::OkStatus();
  }

 private:
  EventReceiver CreateSubscriptionReceiver() {
    // Release any existing channel by resetting the handle first
    if (event_sender_.is_open()) {
      event_sender_.Disconnect();
    }
    event_channel_handle_ = {};  // Destroy old handle to release storage

    auto [handle, sender, receiver] =
        pw::async2::CreateSpscChannel<ReceivedEvent>(event_channel_storage_);
    event_channel_handle_ = std::move(handle);
    event_sender_ = std::move(sender);
    return std::move(receiver);
  }

  pw::async2::ValueProvider<pw::Status> publish_provider_;

  // Event channel for subscription
  pw::async2::ChannelStorage<ReceivedEvent, kMockEventChannelCapacity>
      event_channel_storage_;
  pw::async2::SpscChannelHandle<ReceivedEvent> event_channel_handle_;
  pw::async2::Sender<ReceivedEvent> event_sender_;

  PublishedEvent last_published_;
  size_t publish_count_ = 0;
  pw::InlineString<kMaxEventNameSize> subscription_prefix_;

  // Variable storage
  std::array<RegisteredVariable, kMaxCloudVariables> variables_{};
  // Use shared_ptr instead of unique_ptr<void, fn_ptr> to avoid
  // initialization issues with function pointer deleters
  std::array<std::shared_ptr<void>, kMaxCloudVariables> variable_storage_{};
  size_t variable_count_ = 0;
  static inline RegisteredVariable empty_variable_{};

  // Function storage
  std::array<RegisteredFunction, kMaxCloudFunctions> functions_{};
  size_t function_count_ = 0;
  static inline RegisteredFunction empty_function_{};
};

}  // namespace pb::cloud
