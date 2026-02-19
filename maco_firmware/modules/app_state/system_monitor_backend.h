// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "pw_async2/dispatcher.h"

namespace maco::app_state {

class SystemStateUpdater;

/// Backend interface for monitoring platform-specific system state.
///
/// Implementations subscribe to platform events (Device OS on P2, stubs on
/// host) and push state changes to the updater.
///
/// - P2: Subscribes to network_status, cloud_status, time_changed events
/// - Host: Sets everything to connected/synced immediately
class SystemMonitorBackend {
 public:
  virtual ~SystemMonitorBackend() = default;

  /// Start monitoring system events and push changes to the updater.
  virtual void Start(SystemStateUpdater& updater,
                     pw::async2::Dispatcher& dispatcher) = 0;
};

}  // namespace maco::app_state
