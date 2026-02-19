// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/app_state/system_state.h"

#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"

namespace maco::app_state {

SystemState::SystemState(SystemMonitorBackend& backend) : backend_(backend) {}

void SystemState::Start(pw::async2::Dispatcher& dispatcher) {
  backend_.Start(*this, dispatcher);
}

void SystemState::SetReady() {
  {
    std::lock_guard lock(mutex_);
    boot_state_ = BootState::kReady;
  }
  PW_LOG_INFO("System ready");
}

void SystemState::SetGatewayClient(gateway::GatewayClient* client) {
  std::lock_guard lock(mutex_);
  gateway_client_ = client;
}

void SystemState::SetWifiState(WifiState state) {
  std::lock_guard lock(mutex_);
  wifi_state_ = state;
}

void SystemState::SetCloudState(CloudState state) {
  std::lock_guard lock(mutex_);
  cloud_state_ = state;
}

void SystemState::SetUtcBootOffsetSeconds(int64_t offset) {
  std::lock_guard lock(mutex_);
  utc_boot_offset_seconds_ = offset;
}

void SystemState::GetSnapshot(SystemStateSnapshot& out) const {
  using std::chrono::duration_cast;
  using std::chrono::seconds;

  std::lock_guard lock(mutex_);
  out.boot_state = boot_state_;
  out.wifi_state = wifi_state_;
  out.cloud_state = cloud_state_;
  out.gateway_connected =
      gateway_client_ != nullptr && gateway_client_->IsConnected();

  if (utc_boot_offset_seconds_.has_value()) {
    out.time_synced = true;
    int64_t boot_secs = duration_cast<seconds>(
        pw::chrono::SystemClock::now().time_since_epoch()).count();
    int64_t utc_secs = boot_secs + *utc_boot_offset_seconds_;
    out.wall_clock = pw::chrono::SystemClock::time_point(
        duration_cast<pw::chrono::SystemClock::duration>(seconds(utc_secs)));
  } else {
    out.time_synced = false;
    out.wall_clock = pw::chrono::SystemClock::time_point{};
  }
}

}  // namespace maco::app_state
