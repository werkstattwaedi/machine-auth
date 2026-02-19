// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/system_monitor_backend.h"

namespace maco {

/// P2 backend: subscribes to Device OS network/cloud/time events.
///
/// Event callbacks run on the application thread. Each callback
/// calls a single setter on the updater, which acquires the mutex
/// individually — no lock ordering issues.
class P2SystemMonitor : public app_state::SystemMonitorBackend {
 public:
  void Start(app_state::SystemStateUpdater& updater,
             pw::async2::Dispatcher& dispatcher) override;
};

}  // namespace maco
