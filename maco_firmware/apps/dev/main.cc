// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include "device_secrets/device_secrets.h"
#include "gateway/gateway_client.h"
#include "maco_firmware/modules/app_state/session_controller.h"
#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/app_state/tag_verifier.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/machine_relay/relay_controller.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/stack_monitor/stack_monitor.h"
#include "maco_firmware/modules/terminal_ui/terminal_ui.h"
#include "maco_firmware/system/system.h"
#include "pw_async2/system_time_provider.h"
#include "pw_log/log.h"
#include "pw_system/system.h"

namespace {

void AppInit() {
  PW_LOG_INFO("MACO Dev Firmware initializing...");

  // System state (boot progress, connectivity, time)
  auto& monitor_backend = maco::system::GetSystemMonitorBackend();
  static maco::app_state::SystemState system_state(monitor_backend);

  // Initialize display module (handles LVGL init, drivers, render thread)
  static maco::display::Display display;
  auto& display_driver = maco::system::GetDisplayDriver();
  auto& touch_driver = maco::system::GetTouchButtonDriver();

  // Terminal UI coordinator (owns AppShell, StatusBar, and screen management).
  static maco::terminal_ui::TerminalUi terminal_ui(display, system_state);

  auto status = display.Init(display_driver, touch_driver);
  if (!status.ok()) {
    PW_LOG_ERROR("Display init failed");
    return;
  }
  PW_LOG_INFO("Display initialized: %dx%d", display.width(), display.height());

  // Start system monitor (subscribes to platform events)
  system_state.Start(pw::System().dispatcher());

  // Session state machine and observers
  static maco::app_state::SessionFsm session_fsm;
  static maco::machine_relay::RelayController relay_controller(
      maco::system::GetMachineRelay(),
      pw::async2::GetSystemTimeProvider(),
      pw::System().allocator()
  );
  session_fsm.AddObserver(&relay_controller);
  relay_controller.Start(pw::System().dispatcher());

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
    terminal_ui.SetController(nullptr);
  } else {
    maco::system::GetGatewayClient().Start(pw::System().dispatcher());
    system_state.SetGatewayClient(&maco::system::GetGatewayClient());

    static maco::app_state::TagVerifier tag_verifier(
        nfc_reader,
        maco::system::GetDeviceSecrets(),
        maco::system::GetFirebaseClient(),
        maco::system::GetRandomGenerator(),
        pw::System().allocator()
    );
    tag_verifier.AddObserver(&session_fsm);
    tag_verifier.Start(pw::System().dispatcher());

    // Session controller - drives timeouts, hold detection, UI action bridge
    static maco::app_state::SessionController controller(
        tag_verifier,
        session_fsm,
        pw::async2::GetSystemTimeProvider(),
        pw::System().allocator()
    );
    controller.Start(pw::System().dispatcher());
    terminal_ui.SetController(&controller);
  }

  system_state.SetReady();

  maco::StartStackMonitor();

  PW_LOG_INFO("AppInit complete - place a card on the reader");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
