// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include <memory>

#include "maco_firmware/apps/dev/screens/nfc_test_screen.h"
#include "maco_firmware/modules/app_state/app_state.h"
#include "maco_firmware/modules/app_state/tag_verifier.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/status_bar/status_bar.h"
#include "maco_firmware/modules/ui/app_shell.h"
#include "maco_firmware/system/system.h"
#include "pw_log/log.h"
#include "pw_system/system.h"

namespace {

void AppInit() {
  PW_LOG_INFO("MACO Dev Firmware initializing...");

  // Initialize display module (handles LVGL init, drivers, render thread)
  static maco::display::Display display;
  auto& display_driver = maco::system::GetDisplayDriver();
  auto& touch_driver = maco::system::GetTouchButtonDriver();

  // Snapshot provider - bridges UI thread to app state
  auto snapshot_provider = [](maco::app_state::AppStateSnapshot& snapshot) {
    maco::system::GetAppState().GetSnapshot(snapshot);
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

  // Start tag verifier to authenticate NFC tags and update app state
  static maco::app_state::TagVerifier tag_verifier(
      nfc_reader,
      maco::system::GetAppState(),
      maco::system::GetDeviceSecrets(),
      maco::system::GetRandomGenerator(),
      pw::System().allocator());
  tag_verifier.Start(pw::System().dispatcher());

  PW_LOG_INFO("AppInit complete - place a card on the reader");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
