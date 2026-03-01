// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_async2/coro.h"
#include "pw_status/status.h"

namespace maco::machine_control {

/// Controls the power toggle for the machine tool.
///
/// Implementations handle the specific hardware (relay, TCP/IP, I2C, etc.)
/// The toggle enables/disables power to the controlled machine equipment.
///
/// Typical usage (within a coroutine):
/// @code
///   auto& toggle = maco::system::GetMachineToggle();
///   toggle.Init();
///
///   // Enable machine power
///   auto status = co_await toggle.Enable(cx);
///   if (!status.ok()) { /* handle error */ }
///
///   // ... machine in use ...
///
///   // Disable machine power
///   status = co_await toggle.Disable(cx);
/// @endcode
class MachineToggle {
 public:
  virtual ~MachineToggle() = default;

  /// Initialize the toggle and read current state.
  /// @return OkStatus on success, error otherwise
  virtual pw::Status Init() = 0;

  /// Returns true if machine power is enabled.
  virtual bool IsEnabled() const = 0;

  /// Enable machine power asynchronously.
  /// @param cx Coroutine context for suspension
  /// @return OkStatus on success, error otherwise
  virtual pw::async2::Coro<pw::Status> Enable(pw::async2::CoroContext& cx) = 0;

  /// Disable machine power asynchronously.
  /// @param cx Coroutine context for suspension
  /// @return OkStatus on success, error otherwise
  virtual pw::async2::Coro<pw::Status> Disable(pw::async2::CoroContext& cx) = 0;
};

}  // namespace maco::machine_control
