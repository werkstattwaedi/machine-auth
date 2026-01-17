// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/apps/dev/screens/nfc_test_screen.h"

#include "maco_firmware/modules/nfc_tag/nfc_tag.h"
#include "pw_log/log.h"

namespace maco::dev {

NfcTestScreen::NfcTestScreen(nfc::NfcReader& nfc_reader)
    : Screen("NfcTest"), nfc_reader_(nfc_reader) {
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

void NfcTestScreen::OnUpdate() {
  // Update NFC status from reader
  UpdateNfcStatus();

  // Only update LVGL widget if status changed
  if (status_dirty_ && status_label_) {
    lv_label_set_text(status_label_, status_text_.c_str());
    status_dirty_ = false;
  }
}

ui::ButtonConfig NfcTestScreen::GetButtonConfig() const {
  // No button actions for this simple test screen
  return {};
}

void NfcTestScreen::UpdateNfcStatus() {
  pw::StringBuffer<64> new_status;

  if (nfc_reader_.HasTag()) {
    auto tag = nfc_reader_.GetCurrentTag();
    if (tag) {
      new_status << "Card: ";
      FormatUidTo(new_status, tag->uid());
    } else {
      new_status << "No card";
    }
  } else {
    new_status << "No card";
  }

  // Only mark dirty if status actually changed
  if (new_status.view() != status_text_.view()) {
    status_text_.clear();
    status_text_ << new_status.view();
    status_dirty_ = true;
  }
}

void NfcTestScreen::FormatUidTo(pw::StringBuilder& out, pw::ConstByteSpan uid) {
  for (size_t i = 0; i < uid.size(); i++) {
    if (i > 0) {
      out << ':';
    }
    out.Format("%02X", static_cast<unsigned>(uid[i]));
  }
}

}  // namespace maco::dev
