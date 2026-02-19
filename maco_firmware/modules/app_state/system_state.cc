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

void SystemState::SetTimeSynced(bool synced) {
  std::lock_guard lock(mutex_);
  time_synced_ = synced;
}

void SystemState::SetUtcOffsetSeconds(int32_t offset) {
  std::lock_guard lock(mutex_);
  utc_offset_seconds_ = offset;
}

void SystemState::GetSnapshot(SystemStateSnapshot& out) const {
  std::lock_guard lock(mutex_);
  out.boot_state = boot_state_;
  out.wifi_state = wifi_state_;
  out.cloud_state = cloud_state_;
  out.time_synced = time_synced_;
  out.utc_offset_seconds = utc_offset_seconds_;
  out.wall_clock = pw::chrono::SystemClock::now();
  out.gateway_connected =
      gateway_client_ != nullptr && gateway_client_->IsConnected();
}

}  // namespace maco::app_state
