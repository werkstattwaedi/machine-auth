// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/session_controller.h"
#include "pw_async2/dispatcher.h"
#include "pw_function/function.h"

namespace maco::machine_control {

/// Senses whether the machine is actually running.
///
/// Implementations own their own polling loop and notify via callback
/// when the running state changes. Each implementation decides its own
/// poll rate based on the cost of sensing (local GPIO read vs. TCP/IP
/// round-trip vs. ADC sampling).
///
/// After Start(), implementations must call NotifyRunning() at least
/// once with the initial state before entering their poll loop.
class MachineSensor {
 public:
  using Callback = pw::Function<void(bool running)>;
  using ActivityCallback =
      pw::Function<void(app_state::MachineActivity activity)>;

  virtual ~MachineSensor() = default;

  /// Register a callback invoked when the running state changes.
  /// Also invoked once with the initial state after Start().
  void SetCallback(Callback callback) { callback_ = std::move(callback); }

  /// Register a callback for the machine's activity, for sensors that tell it
  /// apart from billable use (ADR-0054). Sensors that don't call
  /// NotifyActivity() leave activity derived from running.
  void SetActivityCallback(ActivityCallback callback) {
    activity_callback_ = std::move(callback);
  }

  /// Begin polling. Implementations own their poll rate.
  virtual void Start(pw::async2::Dispatcher& dispatcher) = 0;

 protected:
  void NotifyRunning(bool running) {
    if (callback_) callback_(running);
  }

  void NotifyActivity(app_state::MachineActivity activity) {
    if (activity_callback_) activity_callback_(activity);
  }

 private:
  Callback callback_;
  ActivityCallback activity_callback_;
};

}  // namespace maco::machine_control
