// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/host/host_system_monitor.h"

#include <chrono>

#include "maco_firmware/modules/app_state/system_state_updater.h"
#include "pw_chrono/system_clock.h"

namespace maco {

void HostSystemMonitor::Start(app_state::SystemStateUpdater& updater,
                              pw::async2::Dispatcher& /*dispatcher*/) {
  updater.SetWifiState(app_state::WifiState::kConnected);
  updater.SetCloudState(app_state::CloudState::kConnected);

  // Derive the offset so that SystemClock::now() + offset = UTC Unix seconds.
  int64_t utc_secs = std::chrono::duration_cast<std::chrono::seconds>(
      std::chrono::system_clock::now().time_since_epoch()).count();
  int64_t boot_secs = std::chrono::duration_cast<std::chrono::seconds>(
      pw::chrono::SystemClock::now().time_since_epoch()).count();
  updater.SetUtcBootOffsetSeconds(utc_secs - boot_secs);
}

}  // namespace maco
