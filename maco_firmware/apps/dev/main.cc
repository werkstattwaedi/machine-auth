// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include "device_config/device_config.h"
#include "device_secrets/device_secrets.h"
#include "gateway/gateway_client.h"
#include "gateway/gateway_connection_check.h"
#include "maco_firmware/modules/app_state/session_controller.h"
#include "maco_firmware/modules/app_state/session_fsm.h"
#include "maco_firmware/modules/app_state/system_state.h"
#include "maco_firmware/modules/app_state/tag_verifier.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/display/display_metrics.h"
#include "maco_firmware/modules/led_animator/button_effects.h"
#include "maco_firmware/modules/led_animator/nfc_effects.h"
#include "maco_firmware/modules/machine_control/default_machine_sensor.h"
#include "maco_firmware/modules/machine_control/machine_controller.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/stack_monitor/stack_monitor.h"
#include "maco_firmware/modules/terminal_led_effects/terminal_led_effects.h"
#include "maco_firmware/modules/terminal_ui/terminal_ui.h"
#include "maco_firmware/services/maco_service.h"
#include "maco_firmware/system/system.h"
#include "session_upload/session_store.h"
#include "session_upload/usage_uploader.h"
#include "pw_async2/system_time_provider.h"
#include "pw_log/log.h"
#include "pw_metric/global.h"
#include "pw_metric/metric_service_nanopb.h"
#include "pw_system/system.h"

namespace {

/// Check for an orphaned session from a prior device reset.
/// If the reset was involuntary (watchdog/panic) and the relay is still on,
/// resume the session. Otherwise close it and queue the usage for upload.
void RecoverOrphanedSession(
    maco::session_upload::SessionStore& store,
    maco::app_state::SessionFsm& fsm,
    maco::machine_control::MachineToggle& toggle) {
  if (!store.HasOrphanedSession()) {
    return;
  }

  auto reset_reason = maco::system::GetResetReason();
  bool relay_on = toggle.IsEnabled();

  if ((reset_reason == maco::system::ResetReason::kWatchdog ||
       reset_reason == maco::system::ResetReason::kPanic) &&
      relay_on) {
    // Machine still running after involuntary reset - resume session
    auto session = store.LoadOrphanedSession();
    if (session.ok()) {
      PW_LOG_INFO("Resuming session for %s after device reset",
                  session->user_label.c_str());
      fsm.receive(maco::app_state::session_event::SessionResume(
          session->tag_uid, session->user_id, session->user_label,
          session->auth_id, session->started_at));
      fsm.SyncSnapshot();
    }
  } else {
    // Close orphaned session with estimated end time
    auto session = store.LoadOrphanedSession();
    auto last_seen = store.LoadOrphanedLastSeenUnix();
    if (session.ok()) {
      PW_LOG_INFO("Closing orphaned session for %s",
                  session->user_label.c_str());
      maco::app_state::MachineUsage usage;
      usage.user_id = session->user_id;
      usage.auth_id = session->auth_id;
      usage.check_in = session->started_at;
      // Use last_seen as check_out (already in unix seconds)
      usage.check_out = pw::chrono::SystemClock::time_point(
          std::chrono::seconds(last_seen.ok() ? *last_seen : 0));
      usage.reason = maco::app_state::CheckoutReason::kDeviceReset;
      // utc_offset=0 because timestamps are already unix seconds
      auto store_status =
          store.StoreCompletedUsage(usage, /*utc_offset=*/0);
      if (!store_status.ok()) {
        PW_LOG_WARN("Failed to queue orphaned usage: %d",
                    static_cast<int>(store_status.code()));
      }
    }
    store.ClearActiveSession().IgnoreError();
  }
}

void AppInit() {
  PW_LOG_INFO("MACO Dev Firmware initializing...");

  // Initialize LED animator: buttons and NFC off until system is ready.
  // The ambient ring boot animation is started by TerminalLedEffects::Start().
  auto& led = maco::system::GetLedAnimator();
  for (maco::Button b : maco::kAllButtons) {
    led.SetButtonEffect(b, maco::led_animator::OffButton());
  }
  led.SetNfcEffect(maco::led_animator::OffNfc());

  // System state (boot progress, connectivity, time)
  auto& monitor_backend = maco::system::GetSystemMonitorBackend();
  static maco::app_state::SystemState system_state(monitor_backend);

  // Initialize display module (handles LVGL init, drivers, render thread)
  static maco::display::Display display;
  auto& display_driver = maco::system::GetDisplayDriver();
  auto& touch_driver = maco::system::GetTouchButtonDriver();

  // Read machine label from device config into system state
  auto& config = maco::system::GetDeviceConfig();
  system_state.SetMachineLabel(
      config.machine_count() > 0 ? config.machine(0).label() : "MaCo"
  );

  // Terminal UI coordinator (owns AppShell, StatusBar, and screen management).
  static maco::terminal_ui::TerminalUi terminal_ui(display, system_state, led);

  auto status = display.Init(display_driver, touch_driver);
  if (!status.ok()) {
    PW_LOG_ERROR("Display init failed");
    return;
  }
  PW_LOG_INFO("Display initialized: %dx%d", display.width(), display.height());

  // Start system monitor (subscribes to platform events)
  system_state.Start(pw::System().dispatcher());

  // LED ring effects driven by session and tag-verification state.
  // Start() begins the boot animation immediately; the coroutine transitions
  // to idle once system_state reports kReady.
  static maco::terminal_led_effects::TerminalLedEffects terminal_led_effects(
      led,
      system_state,
      pw::async2::GetSystemTimeProvider(),
      pw::System().allocator()
  );
  terminal_led_effects.Start(pw::System().dispatcher());

  // Wait for USB serial after splash screen is visible so the user sees
  // something while the device waits for a console connection.
  maco::system::WaitForUsbSerial();

  // Session state machine and observers
  static maco::app_state::SessionFsm session_fsm;
  auto& machine_toggle = maco::system::GetMachineToggle();
  PW_CHECK_OK(machine_toggle.Init());

  // Session persistence store (KVS-backed)
  static maco::session_upload::SessionStore session_store(
      maco::system::GetSessionKvs());

  RecoverOrphanedSession(session_store, session_fsm, machine_toggle);

  static maco::machine_control::MachineController machine_controller(
      machine_toggle,
      pw::async2::GetSystemTimeProvider(),
      pw::System().allocator()
  );

  static maco::machine_control::DefaultMachineSensor default_sensor(
      machine_toggle,
      pw::async2::GetSystemTimeProvider(),
      pw::System().allocator()
  );
  default_sensor.SetCallback([](bool running) {
    machine_controller.OnMachineRunning(running);
  });

  session_fsm.AddObserver(&machine_controller);
  machine_controller.Start(pw::System().dispatcher());
  default_sensor.Start(pw::System().dispatcher());
  terminal_ui.SetMachineController(&machine_controller);
  session_fsm.AddObserver(&terminal_led_effects);

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
    system_state.SetReady();
  } else {
    maco::system::GetGatewayClient().Start(pw::System().dispatcher());

    static maco::gateway::GatewayConnectionCheck gateway_connection_check(
        maco::system::GetGatewayClient(),
        system_state,
        pw::async2::GetSystemTimeProvider(),
        pw::System().allocator());
    gateway_connection_check.Start(pw::System().dispatcher());

    static maco::app_state::TagVerifier tag_verifier(
        nfc_reader,
        maco::system::GetDeviceSecrets(),
        maco::system::GetFirebaseClient(),
        maco::system::GetRandomGenerator(),
        pw::System().allocator()
    );
    tag_verifier.AddObserver(&session_fsm);
    tag_verifier.AddObserver(&terminal_led_effects);
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

    // Usage uploader - persists sessions and uploads usage to Firebase
    static maco::session_upload::UsageUploader usage_uploader(
        session_store,
        maco::system::GetFirebaseClient(),
        system_state,
        config,
        pw::async2::GetSystemTimeProvider(),
        pw::System().allocator()
    );
    session_fsm.AddObserver(&usage_uploader);
    usage_uploader.Start(pw::System().dispatcher());
  }

  // Register RPC services
  static maco::MacoService maco_service;
  pw::System().rpc_server().RegisterService(maco_service);

  static pw::metric::MetricService metric_service(pw::metric::global_metrics,
                                                  pw::metric::global_groups);
  pw::System().rpc_server().RegisterService(metric_service);

  // SetReady() is called by GatewayConnectionCheck on first successful ping,
  // or immediately above if the device is not provisioned.

  maco::StartStackMonitor(
      std::chrono::seconds(30), maco::display::metrics::OnThreadStackScan
  );

  PW_LOG_INFO("AppInit complete - place a card on the reader");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
