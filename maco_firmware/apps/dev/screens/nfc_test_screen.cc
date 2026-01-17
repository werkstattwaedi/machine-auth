// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/apps/dev/screens/nfc_test_screen.h"

#include "pw_log/log.h"

namespace maco::dev {

NfcTestScreen::NfcTestScreen() : Screen("NfcTest") {
  status_text_ << "No card";
}

pw::Status NfcTestScreen::OnActivate() {
  // Create LVGL screen
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  // Create input group for keypad navigation
  lv_group_ = lv_group_create();

  // Style: dark background
  lv_obj_set_style_bg_color(lv_screen_, lv_color_hex(0x1a1a2e), LV_PART_MAIN);

  // Title label
  lv_obj_t* title = lv_label_create(lv_screen_);
  lv_label_set_text(title, "NFC Test");
  lv_obj_set_style_text_color(title, lv_color_hex(0x4fc3f7), LV_PART_MAIN);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 60);

  // NFC status label (centered)
  status_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(status_label_, status_text_.c_str());
  lv_obj_set_style_text_color(status_label_, lv_color_white(), LV_PART_MAIN);
  lv_obj_center(status_label_);

  // Instruction label
  lv_obj_t* instruction = lv_label_create(lv_screen_);
  lv_label_set_text(instruction, "Place card on reader");
  lv_obj_set_style_text_color(instruction, lv_color_hex(0x888888), LV_PART_MAIN);
  lv_obj_align(instruction, LV_ALIGN_BOTTOM_MID, 0, -80);

  PW_LOG_INFO("NfcTestScreen activated");
  return pw::OkStatus();
}

void NfcTestScreen::OnDeactivate() {
  if (lv_group_) {
    lv_group_delete(lv_group_);
    lv_group_ = nullptr;
  }
  if (lv_screen_) {
    lv_obj_delete(lv_screen_);
    lv_screen_ = nullptr;
  }
  PW_LOG_INFO("NfcTestScreen deactivated");
}

void NfcTestScreen::OnUpdate(const app_state::AppStateSnapshot& snapshot) {
  // Update watched state
  state_watched_.Set(snapshot.state);

  // Only update LVGL widget if state changed
  if (state_watched_.CheckAndClearDirty()) {
    UpdateStatusText(snapshot);
    if (status_label_) {
      lv_label_set_text(status_label_, status_text_.c_str());
    }
  }
}

ui::ButtonConfig NfcTestScreen::GetButtonConfig() const {
  // No button actions for this simple test screen
  return {};
}

void NfcTestScreen::UpdateStatusText(
    const app_state::AppStateSnapshot& snapshot) {
  status_text_.clear();
  if (snapshot.state == app_state::AppStateId::kHasTag) {
    status_text_ << "Card: ";
    FormatUidTo(status_text_, snapshot.tag_uid);
  } else {
    status_text_ << "No card";
  }
}

void NfcTestScreen::FormatUidTo(pw::StringBuilder& out,
                                const app_state::TagUid& uid) {
  for (size_t i = 0; i < uid.size; i++) {
    if (i > 0) {
      out << ':';
    }
    out.Format("%02X", static_cast<unsigned>(uid.bytes[i]));
  }
}

}  // namespace maco::dev
