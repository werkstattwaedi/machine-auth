// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <chrono>
#include <cstddef>
#include <optional>

#include "maco_firmware/modules/buzzer/buzzer.h"
#include "pw_async2/coro.h"
#include "pw_status/status.h"

namespace maco::buzzer {

/// Mock buzzer implementation for host simulator and unit tests.
///
/// Silent, records calls for verification. Supports error injection
/// for testing error handling paths.
class MockBuzzer : public Buzzer {
 public:
  MockBuzzer() = default;

  pw::Status Init() override {
    initialized_ = true;
    return pw::OkStatus();
  }

  void Beep(uint32_t frequency_hz,
            std::chrono::milliseconds duration) override {
    if (!initialized_) {
      return;
    }
    last_frequency_hz_ = frequency_hz;
    last_duration_ = duration;
    beep_count_++;
  }

  void Stop() override { stop_count_++; }

  pw::async2::Coro<pw::Status> PlayMelody(
      [[maybe_unused]] pw::async2::CoroContext& cx,
      [[maybe_unused]] pw::span<const Note> melody) override {
    if (!initialized_) {
      co_return pw::Status::FailedPrecondition();
    }
    if (next_error_.has_value()) {
      auto err = *next_error_;
      next_error_.reset();
      co_return err;
    }
    melody_count_++;
    co_return pw::OkStatus();
  }

  // -- Test Helpers --

  size_t beep_count() const { return beep_count_; }
  uint32_t last_frequency_hz() const { return last_frequency_hz_; }
  std::chrono::milliseconds last_duration() const { return last_duration_; }
  size_t melody_count() const { return melody_count_; }
  size_t stop_count() const { return stop_count_; }
  bool initialized() const { return initialized_; }

  /// Set an error to be returned by the next PlayMelody call.
  void SetNextError(pw::Status err) { next_error_ = err; }

  /// Reset all state for a fresh test.
  void Reset() {
    initialized_ = false;
    beep_count_ = 0;
    last_frequency_hz_ = 0;
    last_duration_ = std::chrono::milliseconds{0};
    melody_count_ = 0;
    stop_count_ = 0;
    next_error_.reset();
  }

 private:
  bool initialized_ = false;
  size_t beep_count_ = 0;
  uint32_t last_frequency_hz_ = 0;
  std::chrono::milliseconds last_duration_{0};
  size_t melody_count_ = 0;
  size_t stop_count_ = 0;
  std::optional<pw::Status> next_error_;
};

}  // namespace maco::buzzer
