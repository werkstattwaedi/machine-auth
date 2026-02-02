// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstddef>
#include <optional>

#include "maco_firmware/modules/machine_relay/machine_relay.h"
#include "pw_async2/coro.h"
#include "pw_status/status.h"

namespace maco::machine_relay {

/// Mock relay implementation for host simulator and unit tests.
///
/// Provides instant state changes with no delays. Supports error injection
/// for testing error handling paths.
class MockMachineRelay : public MachineRelay {
 public:
  MockMachineRelay() = default;

  pw::Status Init() override {
    initialized_ = true;
    return pw::OkStatus();
  }

  bool IsEnabled() const override { return enabled_; }

  pw::async2::Coro<pw::Status> Enable(pw::async2::CoroContext& cx) override {
    if (!initialized_) {
      co_return pw::Status::FailedPrecondition();
    }
    co_return co_await DoSetState(cx, true);
  }

  pw::async2::Coro<pw::Status> Disable(pw::async2::CoroContext& cx) override {
    if (!initialized_) {
      co_return pw::Status::FailedPrecondition();
    }
    co_return co_await DoSetState(cx, false);
  }

  // -- Test Helpers --

  /// Directly set the enabled state (for test setup).
  void SetEnabled(bool on) { enabled_ = on; }

  /// Set an error to be returned by the next Enable/Disable call.
  void SetNextError(pw::Status err) { next_error_ = err; }

  /// Get the number of toggle operations performed.
  size_t toggle_count() const { return toggle_count_; }

  /// Check if Init() was called.
  bool initialized() const { return initialized_; }

  /// Reset all state for a fresh test.
  void Reset() {
    enabled_ = false;
    initialized_ = false;
    toggle_count_ = 0;
    next_error_.reset();
  }

 private:
  pw::async2::Coro<pw::Status> DoSetState(
      [[maybe_unused]] pw::async2::CoroContext& cx, bool on) {
    if (next_error_.has_value()) {
      auto err = *next_error_;
      next_error_.reset();
      co_return err;
    }
    enabled_ = on;
    toggle_count_++;
    co_return pw::OkStatus();
  }

  bool enabled_ = false;
  bool initialized_ = false;
  size_t toggle_count_ = 0;
  std::optional<pw::Status> next_error_;
};

}  // namespace maco::machine_relay
