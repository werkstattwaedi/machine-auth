// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include <cstdint>
#include <optional>

#include "maco_firmware/modules/app_state/system_monitor_backend.h"
#include "maco_firmware/modules/app_state/system_state_updater.h"
#include "maco_firmware/modules/app_state/ui/snapshot.h"
#include "pw_string/string.h"
#include "pw_sync/lock_annotations.h"
#include "pw_sync/mutex.h"

namespace maco::app_state {

/// Thread-safe system state for boot progress, connectivity, and time.
///
/// Each setter individually acquires the mutex. GetSnapshot() reads
/// SystemClock::now() at call time.
class SystemState : public SystemStateUpdater {
 public:
  explicit SystemState(SystemMonitorBackend& backend);

  /// Start the backend monitor.
  void Start(pw::async2::Dispatcher& dispatcher);

  /// Mark the system as ready (boot complete).
  void SetReady();

  /// Set the machine label from device config.
  void SetMachineLabel(std::string_view label);

  /// Update gateway connectivity state (called by GatewayConnectionCheck).
  void SetGatewayConnected(bool connected);

  // SystemStateUpdater overrides (backend calls these)
  void SetWifiState(WifiState state) override;
  void SetCloudState(CloudState state) override;
  void SetUtcBootOffsetSeconds(int64_t offset) override;

  /// Thread-safe snapshot for UI. Reads SystemClock::now() at call time.
  void GetSnapshot(SystemStateSnapshot& out) const;

 private:
  SystemMonitorBackend& backend_;
  bool gateway_connected_ PW_GUARDED_BY(mutex_) = false;

  mutable pw::sync::Mutex mutex_;
  BootState boot_state_ PW_GUARDED_BY(mutex_) = BootState::kBooting;
  WifiState wifi_state_ PW_GUARDED_BY(mutex_) = WifiState::kDisconnected;
  CloudState cloud_state_ PW_GUARDED_BY(mutex_) = CloudState::kDisconnected;
  std::optional<int64_t> utc_boot_offset_seconds_ PW_GUARDED_BY(mutex_);
  pw::InlineString<64> machine_label_ PW_GUARDED_BY(mutex_);
};

}  // namespace maco::app_state
