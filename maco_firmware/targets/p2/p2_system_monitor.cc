// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/targets/p2/p2_system_monitor.h"

#define PW_LOG_MODULE_NAME "sys_mon"

#include <sys/time.h>

#include "maco_firmware/modules/app_state/system_state_updater.h"
#include "pw_assert/check.h"
#include "pw_chrono/system_clock.h"
#include "pw_log/log.h"
#include "rtc_hal.h"
#include "system_cloud.h"
#include "system_network.h"

namespace maco {

void P2SystemMonitor::SyncTimeIfValid() {
  if (!hal_rtc_time_is_valid(nullptr))
    return;
  struct timeval tv;
  if (hal_rtc_get_time(&tv, nullptr) != 0)
    return;
  int64_t boot_secs = std::chrono::duration_cast<std::chrono::seconds>(
                          pw::chrono::SystemClock::now().time_since_epoch()
  )
                          .count();
  updater_->SetUtcBootOffsetSeconds(tv.tv_sec - boot_secs);
}

void P2SystemMonitor::OnSystemEvent(system_event_t event, int param) {
  if (event == network_status) {
    switch (param) {
      case network_status_connected:
        PW_LOG_INFO("network_status: connected");
        updater_->SetWifiState(app_state::WifiState::kConnected);
        break;
      case network_status_powering_on:
        PW_LOG_INFO("network_status: powering_on -> connecting");
        updater_->SetWifiState(app_state::WifiState::kConnecting);
        break;
      case network_status_on:
        PW_LOG_INFO("network_status: on -> connecting");
        updater_->SetWifiState(app_state::WifiState::kConnecting);
        break;
      case network_status_connecting:
        PW_LOG_INFO("network_status: connecting");
        updater_->SetWifiState(app_state::WifiState::kConnecting);
        break;
      case network_status_disconnected:
        PW_LOG_INFO("network_status: disconnected");
        updater_->SetWifiState(app_state::WifiState::kDisconnected);
        break;
      case network_status_disconnecting:
        PW_LOG_INFO("network_status: disconnecting");
        updater_->SetWifiState(app_state::WifiState::kDisconnected);
        break;
      case network_status_off:
        PW_LOG_INFO("network_status: off");
        updater_->SetWifiState(app_state::WifiState::kDisconnected);
        break;
      case network_status_powering_off:
        PW_LOG_INFO("network_status: powering_off");
        updater_->SetWifiState(app_state::WifiState::kDisconnected);
        break;
      default:
        PW_LOG_INFO("network_status: unknown param %d", param);
        break;
    }
  } else if (event == cloud_status) {
    switch (param) {
      case cloud_status_connected:
        PW_LOG_INFO("cloud_status: connected");
        updater_->SetCloudState(app_state::CloudState::kConnected);
        break;
      case cloud_status_connecting:
        PW_LOG_INFO("cloud_status: connecting");
        updater_->SetCloudState(app_state::CloudState::kConnecting);
        break;
      case cloud_status_handshake:
        PW_LOG_INFO("cloud_status: handshake");
        updater_->SetCloudState(app_state::CloudState::kConnecting);
        break;
      case cloud_status_session_resume:
        PW_LOG_INFO("cloud_status: session_resume");
        updater_->SetCloudState(app_state::CloudState::kConnecting);
        break;
      case cloud_status_disconnected:
        PW_LOG_INFO("cloud_status: disconnected");
        updater_->SetCloudState(app_state::CloudState::kDisconnected);
        break;
      case cloud_status_disconnecting:
        PW_LOG_INFO("cloud_status: disconnecting");
        updater_->SetCloudState(app_state::CloudState::kDisconnected);
        break;
      default:
        PW_LOG_INFO("cloud_status: unknown param %d", param);
        break;
    }
  } else if (event == time_changed) {
    PW_LOG_INFO("time_changed: syncing RTC");
    SyncTimeIfValid();
  }
}

void P2SystemMonitor::Start(
    app_state::SystemStateUpdater& updater,
    pw::async2::Dispatcher& /*dispatcher*/
) {
  PW_CHECK(updater_ == nullptr, "P2SystemMonitor::Start() called twice");
  updater_ = &updater;

  // Set initial state from current Device OS status
  if (network_ready(NIF_DEFAULT, NETWORK_READY_TYPE_ANY, nullptr)) {
    updater_->SetWifiState(app_state::WifiState::kConnected);
  }
  if (spark_cloud_flag_connected()) {
    updater_->SetCloudState(app_state::CloudState::kConnected);
  }
  SyncTimeIfValid();

  // Subscribe to ongoing changes via C trampoline.
  // Device OS copies the SystemEventContext into the subscription and passes
  // &copy as the handler's void* context.  We stash `this` in the `callable`
  // field so the callback can recover the P2SystemMonitor pointer.
  SystemEventContext ctx = {};
  ctx.version = SYSTEM_EVENT_CONTEXT_VERSION;
  ctx.size = sizeof(SystemEventContext);
  ctx.callable = this;
  ctx.destructor = nullptr;
  int rc = system_subscribe_event(
      network_status + cloud_status + time_changed,
      [](system_event_t event, int param, void* /*pointer*/, void* context) {
        auto* self = static_cast<P2SystemMonitor*>(
            static_cast<SystemEventContext*>(context)->callable);
        self->OnSystemEvent(event, param);
      },
      &ctx
  );
  if (rc != 0) {
    PW_LOG_ERROR("system_subscribe_event failed: %d", rc);
  }

  PW_LOG_INFO("P2SystemMonitor started");
}

}  // namespace maco
