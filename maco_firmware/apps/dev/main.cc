// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#define PW_LOG_MODULE_NAME "MAIN"

#include <cstdio>

#include "lvgl.h"
#include "maco_firmware/modules/display/display.h"
#include "maco_firmware/modules/nfc_reader/nfc_reader.h"
#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "maco_firmware/system/system.h"
#include "pw_function/function.h"
#include "pw_log/log.h"
#include "pw_system/system.h"

namespace {

// Global state for NFC display
lv_obj_t* g_nfc_label = nullptr;
maco::nfc::NfcReader* g_nfc_reader = nullptr;

// Format UID bytes as hex string
void FormatUid(pw::ConstByteSpan uid, char* buffer, size_t buffer_size) {
  size_t pos = 0;
  for (size_t i = 0; i < uid.size() && pos + 3 < buffer_size; i++) {
    pos += snprintf(buffer + pos, buffer_size - pos, "%02X",
                    static_cast<unsigned>(uid[i]));
    if (i < uid.size() - 1 && pos + 1 < buffer_size) {
      buffer[pos++] = ':';
    }
  }
  buffer[pos] = '\0';
}

// LVGL timer callback to update NFC status label
// Creates the label on first call (runs in render thread context)
void NfcUpdateTimerCallback(lv_timer_t* /*timer*/) {
  // Create label on first call (in render thread context to avoid race)
  if (!g_nfc_label) {
    g_nfc_label = lv_label_create(lv_screen_active());
    lv_label_set_text(g_nfc_label, "No card");
    lv_obj_center(g_nfc_label);
    PW_LOG_INFO("NFC label created");
  }

  if (!g_nfc_reader) return;

  if (g_nfc_reader->HasTag()) {
    auto tag = g_nfc_reader->GetCurrentTag();
    if (tag) {
      char uid_str[32];
      FormatUid(tag->uid(), uid_str, sizeof(uid_str));

      char label_text[64];
      snprintf(label_text, sizeof(label_text), "Card: %s", uid_str);
      lv_label_set_text(g_nfc_label, label_text);
    }
  } else {
    lv_label_set_text(g_nfc_label, "No card");
  }
}

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

  // Create LVGL timer to periodically update NFC status (every 200ms)
  // The timer callback runs in the render thread and will create the label
  lv_timer_create(NfcUpdateTimerCallback, 200, nullptr);

  // Get and initialize NFC reader
  PW_LOG_INFO("Getting NFC reader...");
  g_nfc_reader = &maco::system::GetNfcReader();
  PW_LOG_INFO("Got NFC reader, calling Init()...");

  status = g_nfc_reader->Init();
  if (!status.ok()) {
    PW_LOG_ERROR("NFC reader init failed");
    return;
  }

  PW_LOG_INFO("NFC reader initialized");

  // Start NFC reader task on the system dispatcher.
  // The task will begin running after StartAndClobberTheStack() is called.
  g_nfc_reader->Start(pw::System().dispatcher());

  PW_LOG_INFO("AppInit complete - place a card on the reader");
}

}  // namespace

int main() {
  maco::system::Init(AppInit);
  // Init never returns
}
