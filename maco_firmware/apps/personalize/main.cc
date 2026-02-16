// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include <memory>

#include "maco_firmware/apps/personalize/personalization_rpc_service.h"
#include "maco_firmware/apps/personalize/screens/personalize_screen.h"
#include "maco_firmware/apps/personalize/tag_prober.h"
#include "device_secrets/device_secrets.h"
#include "maco_firmware/modules/display/display.h"
#include "gateway/gateway_client.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/stack_monitor/stack_monitor.h"
#include "maco_firmware/modules/status_bar/status_bar.h"
#include "maco_firmware/modules/ui/app_shell.h"
#include "maco_firmware/system/system.h"
#include "pw_log/log.h"
#include "pw_system/system.h"

namespace {

// Global tag prober pointer for snapshot provider lambda
maco::personalize::TagProber* g_tag_prober = nullptr;

void AppInit() {
  PW_LOG_INFO("MACO Personalize Firmware initializing...");

  // Initialize display with StatusBar + AppShell
  static maco::display::Display display;
  auto& display_driver = maco::system::GetDisplayDriver();
  auto& touch_driver = maco::system::GetTouchButtonDriver();

  // AppState snapshot provider is a no-op — screen uses its own snapshot
  auto snapshot_provider = [](maco::app_state::AppStateSnapshot&) {};

  // Personalize snapshot provider bridges tag prober to screen
  auto personalize_provider =
      [](maco::personalize::PersonalizeSnapshot& snapshot) {
        if (g_tag_prober) {
          g_tag_prober->GetSnapshot(snapshot);
        }
      };

  static maco::status_bar::StatusBar status_bar;
  static maco::ui::AppShell app_shell(display, snapshot_provider);

  display.SetInitCallback([&]() {
    PW_LOG_INFO("Creating UI widgets on render thread...");

    auto status = status_bar.Init();
    if (!status.ok()) {
      PW_LOG_WARN("StatusBar init failed (continuing)");
    }

    status = app_shell.Init();
    if (!status.ok()) {
      PW_LOG_ERROR("AppShell init failed");
      return;
    }

    status = app_shell.Reset(
        std::make_unique<maco::personalize::PersonalizeScreen>(
            personalize_provider));
    if (!status.ok()) {
      PW_LOG_ERROR("Failed to set initial screen");
      return;
    }

    PW_LOG_INFO("UI initialization complete");
  });

  auto status = display.Init(display_driver, touch_driver);
  if (!status.ok()) {
    PW_LOG_ERROR("Display init failed");
    return;
  }
  PW_LOG_INFO("Display initialized: %dx%d", display.width(), display.height());

  // Start NFC reader
  PW_LOG_INFO("Starting NFC reader...");
  auto& nfc_reader = maco::system::GetNfcReader();
  (void)nfc_reader.Start(pw::System().dispatcher());
  PW_LOG_INFO("NFC reader started (init in progress)");

  // Require provisioned device for cloud services
  auto secret = maco::system::GetDeviceSecrets().GetGatewayMasterSecret();
  if (!secret.ok()) {
    PW_LOG_ERROR("Device not provisioned - skipping gateway/cloud services");
  } else {
    maco::system::GetGatewayClient().Start(pw::System().dispatcher());

    static maco::personalize::TagProber tag_prober(
        nfc_reader,
        maco::system::GetDeviceSecrets(),
        maco::system::GetFirebaseClient(),
        maco::system::GetRandomGenerator(),
        pw::System().allocator());
    g_tag_prober = &tag_prober;
    tag_prober.Start(pw::System().dispatcher());

    static maco::personalize::PersonalizationRpcService rpc_service(
        tag_prober);
    pw::System().rpc_server().RegisterService(rpc_service);
  }

  maco::StartStackMonitor();

  PW_LOG_INFO("AppInit complete - tap a tag to probe");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
