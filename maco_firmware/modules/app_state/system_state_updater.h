// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#pragma once

#include "maco_firmware/modules/app_state/ui/snapshot.h"

namespace maco::app_state {

/// Setter-only interface for backends to update system state.
///
/// Backends (P2SystemMonitor, HostSystemMonitor) receive this interface
/// in Start() and call setters when connectivity or time state changes.
/// Keeps backends decoupled from the full SystemState class.
class SystemStateUpdater {
 public:
  virtual ~SystemStateUpdater() = default;
  virtual void SetWifiState(WifiState state) = 0;
  virtual void SetCloudState(CloudState state) = 0;
  virtual void SetTimeSynced(bool synced) = 0;
  virtual void SetUtcOffsetSeconds(int32_t offset) = 0;
};

}  // namespace maco::app_state
