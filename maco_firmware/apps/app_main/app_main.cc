// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include "maco_firmware/apps/app_main/app_main.h"

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
#include "maco_firmware/modules/machine_control/gateway_machine_sensor.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/stack_monitor/stack_monitor.h"
#include "maco_firmware/modules/terminal_effects/terminal_effects.h"
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

namespace maco::apps {

namespace {

// Configuration for the currently running app. Set once by RunApp() before the
// system scheduler starts, then read from AppInit(). A file-scope value (rather
// than a captured lambda) keeps the pw::Function passed to system::Init() a
// plain function pointer — a lambda capturing AppConfig can exceed pw::Function's
// small inline capacity on the 32-bit target.
AppConfig g_config;

// A deterministic boot-time fault (e.g. a failing PW_CHECK) with the watchdog
// armed would reset-loop forever. If this many consecutive boots occur without
// one proving stable (running past the ScheduleBootStableClear window), fall
// back to a minimal safe state instead of re-arming the watchdog (ADR-0040).
constexpr int kMaxConsecutiveBoots = 4;

/// Check for an orphaned session from a prior device reset.
/// If the reset was involuntary (watchdog/panic) and the relay is still on,
/// resume the session. Otherwise close it and queue the usage for upload.
///
/// Returns true iff a session was resumed (so the caller keeps the latching
/// relay energized). In every other path — including the close branch below,
/// which used to leave a latched relay ON — the relay must be driven OFF, so
/// the caller applies the MachineController's fail-safe boot default.
bool RecoverOrphanedSession(
    maco::session_upload::SessionStore& store,
    maco::app_state::SessionFsm& fsm,
    maco::machine_control::MachineToggle& toggle) {
  if (!store.HasOrphanedSession()) {
    return false;
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
      return true;
    }
    // Fall through: couldn't load the session to resume, so treat it as a
    // close and let the relay be de-energized rather than left latched ON.
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
  return false;
}

void AppInit() {
  PW_LOG_INFO("MACO Firmware initializing...");

  // Record this boot and detect a rapid-reset loop before doing anything that
  // could itself fault. boot_loop drives the fail-safe below: no session
  // resume, and the watchdog is not armed.
  const int boot_count = maco::system::RecordBoot();
  const bool boot_loop = boot_count >= kMaxConsecutiveBoots;
  PW_LOG_INFO("Boot #%d after reset reason %d%s", boot_count,
              static_cast<int>(maco::system::GetResetReason()),
              boot_loop ? " - RAPID-RESET LOOP, entering safe state" : "");

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

  // Initialize buzzer for audible feedback on tag events.
  auto& buzzer = maco::system::GetBuzzer();
  if (auto s = buzzer.Init(); !s.ok()) {
    PW_LOG_WARN("Buzzer init failed: %d", static_cast<int>(s.code()));
  }

  // LED ring + buzzer effects driven by session and tag-verification state.
  // Start() begins the boot animation immediately; the coroutine transitions
  // to idle once system_state reports kReady.
  static maco::terminal_effects::TerminalEffects terminal_effects(
      led,
      buzzer,
      system_state,
      pw::async2::GetSystemTimeProvider(),
      pw::System().allocator()
  );
  terminal_effects.Start(pw::System().dispatcher());

  // Wait for USB serial after splash screen is visible so the user sees
  // something while the device waits for a console connection. Dev only —
  // production terminals have no console attached (ADR-0040).
  if (g_config.wait_for_usb_serial) {
    maco::system::WaitForUsbSerial();
  }

  // Session state machine and observers
  static maco::app_state::SessionFsm session_fsm;
  auto& machine_toggle = maco::system::GetMachineToggle();
  PW_CHECK_OK(machine_toggle.Init());

  // Session persistence store (KVS-backed)
  static maco::session_upload::SessionStore session_store(
      maco::system::GetSessionKvs());

  bool resumed_session = false;
  if (boot_loop) {
    // Break the loop: never resume into a boot-looping state; drop any orphaned
    // session so the next healthy boot starts clean and the relay stays off.
    session_store.ClearActiveSession().IgnoreError();
  } else {
    resumed_session =
        RecoverOrphanedSession(session_store, session_fsm, machine_toggle);
  }

  static maco::machine_control::MachineController machine_controller(
      machine_toggle,
      pw::async2::GetSystemTimeProvider(),
      pw::System().allocator()
  );

  // The controller boots with a fail-safe pending Disable that de-energizes
  // the latching relay on its first poll (P0-4). Only a genuinely resumed
  // session keeps it energized; every other boot path leaves the machine
  // powered off until a new tap authorizes it.
  if (resumed_session) {
    machine_controller.KeepToggleEnabledForResume();
  }

  // Report accumulated in-use time (cutting time for the laser) on checkout.
  session_fsm.SetBillableDurationSource(&machine_controller);

  // Select the running-sensor by control type. A gateway-sensed machine (the
  // laser) leases a sensing session from the gateway, which runs the device
  // protocol over the LAN; everything else mirrors the toggle. See ADR-0035.
  const bool is_gateway_sensing =
      config.machine_count() > 0 &&
      config.machine(0).control() ==
          maco::config::MachineControlType::kGatewaySensing;

  static maco::machine_control::DefaultMachineSensor default_sensor(
      machine_toggle,
      pw::async2::GetSystemTimeProvider(),
      pw::System().allocator()
  );

  maco::machine_control::MachineSensor* active_sensor = &default_sensor;
  if (is_gateway_sensing) {
    const auto& gs = config.machine(0).gateway_sensing();
    static maco::machine_control::GatewayMachineSensor gateway_sensor(
        maco::system::GetGatewayClient(),
        gs,
        pw::async2::GetSystemTimeProvider(),
        pw::System().allocator()
    );
    active_sensor = &gateway_sensor;
    // Session-scoped: the sensor leases/polls only while a session is active.
    session_fsm.AddObserver(&gateway_sensor);
    PW_LOG_INFO("Using gateway sensor: kind=%d host=%s",
                static_cast<int>(gs.kind), gs.host.c_str());
  }
  active_sensor->SetCallback([](bool running) {
    machine_controller.OnMachineRunning(running);
  });

  session_fsm.AddObserver(&machine_controller);
  machine_controller.Start(pw::System().dispatcher());
  active_sensor->Start(pw::System().dispatcher());
  terminal_ui.SetMachineController(&machine_controller);
  session_fsm.AddObserver(&terminal_effects);

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

    // Cloud check-in (PR #194) requires machine_id to enforce
    // machine.requiredPermission. Resolve it once here; if the device has
    // no machine configured, an empty ID propagates and TerminalCheckin
    // fails closed with InvalidArgument.
    static const maco::FirebaseId kEmptyMachineId = maco::FirebaseId::Empty();
    if (config.machine_count() > 1) {
      PW_LOG_WARN("DeviceConfig has %u machines; only machine[0] is used "
                  "for cloud check-in",
                  static_cast<unsigned>(config.machine_count()));
    }
    const auto& machine_id =
        config.machine_count() > 0 ? config.machine(0).id() : kEmptyMachineId;

    static maco::app_state::TagVerifier tag_verifier(
        nfc_reader,
        maco::system::GetDeviceSecrets(),
        maco::system::GetFirebaseClient(),
        machine_id,
        maco::system::GetRandomGenerator(),
        system_state,
        pw::System().allocator()
    );
    tag_verifier.AddObserver(&session_fsm);
    tag_verifier.AddObserver(&terminal_effects);
    tag_verifier.Start(pw::System().dispatcher());

    // Session controller - drives timeouts, hold detection, UI action bridge
    static maco::app_state::SessionController controller(
        tag_verifier,
        session_fsm,
        pw::async2::GetSystemTimeProvider(),
        pw::System().allocator()
    );
    // Idle auto-end for activity-tracked machines (the laser): end the session
    // after it sits idle, warning shortly before.
    if (is_gateway_sensing) {
      const auto& gs = config.machine(0).gateway_sensing();
      controller.SetIdleTimeout(&machine_controller,
                                std::chrono::seconds(gs.idle_timeout_sec),
                                std::chrono::seconds(gs.idle_warning_sec));
    }
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

  // Clear the rapid-reset counter once we've run stably, so ordinary reboots
  // don't accumulate toward the safe-state threshold. Runs regardless of the
  // watchdog so a boot-loop-detected boot can still recover next cycle.
  maco::system::ScheduleBootStableClear(std::chrono::seconds(60));

  // Arm the hardware watchdog last, after all init is done, so a slow boot
  // (display, NFC, gateway connect) can't trip it. Skipped in a reset loop
  // (ADR-0040). No-op on host and when the config leaves it disabled (dev).
  if (g_config.enable_watchdog && !boot_loop) {
    maco::system::StartWatchdog(g_config.watchdog_timeout);
  }

  PW_LOG_INFO("AppInit complete - place a card on the reader");
}

}  // namespace

void RunApp(const AppConfig& config) {
  g_config = config;
  maco::system::Init(AppInit);
  // Init never returns.
}

}  // namespace maco::apps
