// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/p2/p2_system_monitor.h"

#include "maco_firmware/modules/app_state/system_state_updater.h"
#include "pw_assert/check.h"
#include "pw_log/log.h"
#include "rtc_hal.h"
#include "system_cloud.h"
#include "system_event.h"
#include "system_network.h"

namespace maco {

namespace {

// Module-level pointer set once in Start(). Event callbacks use this to
// push state changes. Safe because Start() is called once at boot and
// the updater outlives the subscription.
app_state::SystemStateUpdater* g_updater = nullptr;

void OnSystemEvent(system_event_t event, int param, void* /*pointer*/,
                   void* /*context*/) {
  if (!g_updater) return;

  if (event == network_status) {
    switch (param) {
      case network_status_connected:
        g_updater->SetWifiState(app_state::WifiState::kConnected);
        break;
      case network_status_powering_on:
      case network_status_on:
      case network_status_connecting:
        g_updater->SetWifiState(app_state::WifiState::kConnecting);
        break;
      case network_status_disconnected:
      case network_status_disconnecting:
      case network_status_off:
      case network_status_powering_off:
        g_updater->SetWifiState(app_state::WifiState::kDisconnected);
        break;
      default:
        break;
    }
  } else if (event == cloud_status) {
    switch (param) {
      case cloud_status_connected:
        g_updater->SetCloudState(app_state::CloudState::kConnected);
        break;
      case cloud_status_connecting:
      case cloud_status_handshake:
      case cloud_status_session_resume:
        g_updater->SetCloudState(app_state::CloudState::kConnecting);
        break;
      case cloud_status_disconnected:
      case cloud_status_disconnecting:
        g_updater->SetCloudState(app_state::CloudState::kDisconnected);
        break;
      default:
        break;
    }
  } else if (event == time_changed) {
    g_updater->SetTimeSynced(true);
  }
}

}  // namespace

void P2SystemMonitor::Start(app_state::SystemStateUpdater& updater,
                            pw::async2::Dispatcher& /*dispatcher*/) {
  PW_CHECK(g_updater == nullptr, "P2SystemMonitor::Start called twice");
  g_updater = &updater;

  // Set initial state from current Device OS status
  if (network_ready(NIF_DEFAULT, NETWORK_READY_TYPE_ANY, nullptr)) {
    updater.SetWifiState(app_state::WifiState::kConnected);
  }
  if (spark_cloud_flag_connected()) {
    updater.SetCloudState(app_state::CloudState::kConnected);
  }
  if (hal_rtc_time_is_valid(nullptr)) {
    updater.SetTimeSynced(true);
  }

  // Subscribe to ongoing changes
  int rc = system_subscribe_event(
      network_status + cloud_status + time_changed,
      OnSystemEvent, nullptr);
  if (rc != 0) {
    PW_LOG_ERROR("system_subscribe_event failed: %d", rc);
  }

  PW_LOG_INFO("P2SystemMonitor started");
}

}  // namespace maco
