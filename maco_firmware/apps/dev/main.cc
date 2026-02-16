// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include <memory>

#include "maco_firmware/apps/dev/screens/nfc_test_screen.h"
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/session_event_pump.h"
#include "maco_firmware/modules/app_state/tag_verifier.h"
#include "maco_firmware/modules/machine_relay/relay_controller.h"
#include "device_secrets/device_secrets.h"
#include "maco_firmware/modules/display/display.h"
#include "gateway/gateway_client.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/stack_monitor/stack_monitor.h"
#include "maco_firmware/modules/status_bar/status_bar.h"
#include "maco_firmware/modules/ui/app_shell.h"
#include "maco_firmware/system/system.h"
#include "pw_async2/system_time_provider.h"
#include "pw_log/log.h"
#include "pw_system/system.h"

namespace {

void AppInit() {
  PW_LOG_INFO("MACO Dev Firmware initializing...");

  // Initialize display module (handles LVGL init, drivers, render thread)
  static maco::display::Display display;
  auto& display_driver = maco::system::GetDisplayDriver();
  auto& touch_driver = maco::system::GetTouchButtonDriver();

  // Session state machine and observers
  static maco::app_state::SessionFsm session_fsm;
  static maco::machine_relay::RelayController relay_controller(
      maco::system::GetMachineRelay(), pw::async2::GetSystemTimeProvider(),
      pw::System().allocator());
  session_fsm.AddObserver(&relay_controller);
  relay_controller.Start(pw::System().dispatcher());

  // Snapshot provider - bridges UI thread to app state
  auto snapshot_provider = [](maco::app_state::AppStateSnapshot& snapshot) {
    maco::system::GetAppState().GetSnapshot(snapshot);
    session_fsm.GetSnapshot(snapshot.session);
  };

  // Set init callback for LVGL widget creation (runs on render thread)
  // All LVGL operations must happen on the render thread.
  static maco::status_bar::StatusBar status_bar;
  static maco::ui::AppShell app_shell(display, snapshot_provider);

  display.SetInitCallback([&]() {
    PW_LOG_INFO("Creating UI widgets on render thread...");

    // Initialize status bar (persistent chrome on lv_layer_top)
    auto status = status_bar.Init();
    if (!status.ok()) {
      PW_LOG_WARN("StatusBar init failed (continuing)");
    }

    // Initialize AppShell (screen stack, button bar chrome, state propagation)
    status = app_shell.Init();
    if (!status.ok()) {
      PW_LOG_ERROR("AppShell init failed");
      return;
    }

    // Create and show initial screen
    status = app_shell.Reset(std::make_unique<maco::dev::NfcTestScreen>());
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

  // Get and start NFC reader (init happens asynchronously)
  PW_LOG_INFO("Starting NFC reader...");
  auto& nfc_reader = maco::system::GetNfcReader();

  // Start returns a future that resolves when init completes
  // For now, we fire-and-forget - the driver logs errors internally
  (void)nfc_reader.Start(pw::System().dispatcher());
  PW_LOG_INFO("NFC reader started (init in progress)");

  // Check provisioning before starting cloud services.
  // GetGatewayClient() has PW_CHECK_OK that would crash before logs are up.
  auto secret = maco::system::GetDeviceSecrets().GetGatewayMasterSecret();
  if (!secret.ok()) {
    PW_LOG_ERROR("Device not provisioned - skipping gateway/cloud services");
  } else {
    maco::system::GetGatewayClient().Start(pw::System().dispatcher());

    static maco::app_state::TagVerifier tag_verifier(
        nfc_reader,
        maco::system::GetDeviceSecrets(),
        maco::system::GetFirebaseClient(),
        maco::system::GetRandomGenerator(),
        pw::System().allocator());
    tag_verifier.AddObserver(&maco::system::GetAppState());
    tag_verifier.AddObserver(&session_fsm);
    tag_verifier.Start(pw::System().dispatcher());

    // Session event pump - drives timeouts, hold detection, UI action bridge
    static maco::app_state::SessionEventPump session_event_pump(
        session_fsm, pw::async2::GetSystemTimeProvider(),
        pw::System().allocator());
    session_event_pump.Start(pw::System().dispatcher());
  }

  maco::StartStackMonitor();

  PW_LOG_INFO("AppInit complete - place a card on the reader");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
