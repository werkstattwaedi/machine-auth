// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/system_monitor_backend.h"

namespace maco {

/// Host stub: reports everything as connected/synced immediately.
class HostSystemMonitor : public app_state::SystemMonitorBackend {
 public:
  void Start(app_state::SystemStateUpdater& updater,
             pw::async2::Dispatcher& dispatcher) override;
};

}  // namespace maco
