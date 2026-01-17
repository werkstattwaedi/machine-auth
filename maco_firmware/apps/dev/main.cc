// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include <memory>

#include "maco_firmware/apps/dev/screens/nfc_test_screen.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/status_bar/status_bar.h"
#include "maco_firmware/modules/ui/navigator.h"
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

  auto status = display.Init(display_driver, touch_driver);
  if (!status.ok()) {
    PW_LOG_ERROR("Display init failed");
    return;
  }
  PW_LOG_INFO("Display initialized: %dx%d", display.width(), display.height());

  // Initialize status bar (persistent chrome on lv_layer_top)
  static maco::status_bar::StatusBar status_bar;
  status = status_bar.Init();
  if (!status.ok()) {
    PW_LOG_WARN("StatusBar init failed (continuing)");
  }

  // Initialize Navigator (screen stack and button bar chrome)
  static maco::ui::Navigator navigator(display);
  status = navigator.Init();
  if (!status.ok()) {
    PW_LOG_ERROR("Navigator init failed");
    return;
  }

  // Get and initialize NFC reader
  PW_LOG_INFO("Initializing NFC reader...");
  auto& nfc_reader = maco::system::GetNfcReader();

  status = nfc_reader.Init();
  if (!status.ok()) {
    PW_LOG_ERROR("NFC reader init failed");
    return;
  }
  PW_LOG_INFO("NFC reader initialized");

  // Start NFC reader task on the system dispatcher
  nfc_reader.Start(pw::System().dispatcher());

  // Create and show initial screen
  status = navigator.Reset(std::make_unique<maco::dev::NfcTestScreen>(nfc_reader));
  if (!status.ok()) {
    PW_LOG_ERROR("Failed to set initial screen");
    return;
  }

  PW_LOG_INFO("AppInit complete - place a card on the reader");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
