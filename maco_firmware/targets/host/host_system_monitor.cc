// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/host_system_monitor.h"

#include "maco_firmware/modules/app_state/system_state_updater.h"

namespace maco {

void HostSystemMonitor::Start(app_state::SystemStateUpdater& updater,
                              pw::async2::Dispatcher& /*dispatcher*/) {
  updater.SetWifiState(app_state::WifiState::kConnected);
  updater.SetCloudState(app_state::CloudState::kConnected);
  updater.SetTimeSynced(true);
}

}  // namespace maco
