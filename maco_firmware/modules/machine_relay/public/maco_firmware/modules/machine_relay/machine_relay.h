// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_async2/coro.h"
#include "pw_status/status.h"

namespace maco::machine_relay {

/// Controls the power relay for the machine tool.
///
/// Implementations handle the specific relay hardware (latching, standard, etc.)
/// The relay enables/disables power to the controlled machine equipment.
///
/// Typical usage (within a coroutine):
/// @code
///   auto& relay = maco::system::GetMachineRelay();
///   relay.Init();
///
///   // Enable machine power
///   auto status = co_await relay.Enable(cx);
///   if (!status.ok()) { /* handle error */ }
///
///   // ... machine in use ...
///
///   // Disable machine power
///   status = co_await relay.Disable(cx);
/// @endcode
class MachineRelay {
 public:
  virtual ~MachineRelay() = default;

  /// Initialize the relay and read current state.
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

}  // namespace maco::machine_relay
