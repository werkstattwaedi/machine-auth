// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/system_monitor_backend.h"
#include "system_event.h"

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

 private:
  void SyncTimeIfValid();
  void OnSystemEvent(system_event_t event, int param);

  app_state::SystemStateUpdater* updater_ = nullptr;
};

}  // namespace maco
