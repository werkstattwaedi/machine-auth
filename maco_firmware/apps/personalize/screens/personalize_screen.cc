// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/apps/personalize/screens/personalize_screen.h"

#include "pw_log/log.h"

namespace maco::personalize {

PersonalizeScreen::PersonalizeScreen() : Screen("Personalize") {
  status_text_ << "Ready - tap a tag";
}

pw::Status PersonalizeScreen::OnActivate() {
  lv_screen_ = lv_obj_create(nullptr);
  if (!lv_screen_) {
    return pw::Status::Internal();
  }

  lv_group_ = lv_group_create();

  // Dark background
  lv_obj_set_style_bg_color(lv_screen_, lv_color_hex(0x1a1a2e), LV_PART_MAIN);

  // Title
  lv_obj_t* title = lv_label_create(lv_screen_);
  lv_label_set_text(title, "Tag Personalization");
  lv_obj_set_style_text_color(title, lv_color_hex(0x4fc3f7), LV_PART_MAIN);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 60);

  // Status label (centered)
  status_label_ = lv_label_create(lv_screen_);
  lv_label_set_text(status_label_, status_text_.c_str());
  lv_obj_set_style_text_color(status_label_, lv_color_white(), LV_PART_MAIN);
  lv_obj_set_width(status_label_, 220);
  lv_label_set_long_mode(status_label_, LV_LABEL_LONG_WRAP);
  lv_obj_set_style_text_align(status_label_, LV_TEXT_ALIGN_CENTER,
                              LV_PART_MAIN);
  lv_obj_center(status_label_);

  // Instruction
  lv_obj_t* instruction = lv_label_create(lv_screen_);
  lv_label_set_text(instruction, "Use RPC to arm personalization");
  lv_obj_set_style_text_color(instruction, lv_color_hex(0x888888),
                              LV_PART_MAIN);
  lv_obj_align(instruction, LV_ALIGN_BOTTOM_MID, 0, -80);

  PW_LOG_INFO("PersonalizeScreen activated");
  return pw::OkStatus();
}

void PersonalizeScreen::OnDeactivate() {
  if (lv_group_) {
    lv_group_delete(lv_group_);
    lv_group_ = nullptr;
  }
  if (lv_screen_) {
    lv_obj_delete(lv_screen_);
    lv_screen_ = nullptr;
  }
  PW_LOG_INFO("PersonalizeScreen deactivated");
}

void PersonalizeScreen::OnUpdate(const PersonalizeSnapshot& snapshot) {
  state_watched_.Set(snapshot.state);

  if (state_watched_.CheckAndClearDirty()) {
    UpdateStatusText(snapshot);
    if (status_label_) {
      lv_label_set_text(status_label_, status_text_.c_str());
    }
  }
}

ui::ButtonConfig PersonalizeScreen::GetButtonConfig() const { return {}; }

void PersonalizeScreen::UpdateStatusText(const PersonalizeSnapshot& snapshot) {
  status_text_.clear();
  switch (snapshot.state) {
    case PersonalizeStateId::kIdle:
      status_text_ << "Ready - tap a tag";
      break;
    case PersonalizeStateId::kProbing:
      status_text_ << "Reading tag...";
      break;
    case PersonalizeStateId::kFactoryTag:
      status_text_ << "Factory tag\n";
      FormatUidTo(status_text_, snapshot.uid, snapshot.uid_size);
      break;
    case PersonalizeStateId::kMacoTag:
      status_text_ << "MaCo tag\n";
      FormatUidTo(status_text_, snapshot.uid, snapshot.uid_size);
      break;
    case PersonalizeStateId::kUnknownTag:
      status_text_ << "Unknown tag";
      break;
    case PersonalizeStateId::kAwaitingTag:
      status_text_ << "Waiting for tag\nto personalize...";
      break;
    case PersonalizeStateId::kPersonalizing:
      status_text_ << "Personalizing...";
      break;
    case PersonalizeStateId::kPersonalized:
      status_text_ << "Tag personalized!\n";
      FormatUidTo(status_text_, snapshot.uid, snapshot.uid_size);
      break;
    case PersonalizeStateId::kError:
      status_text_ << "Error: ";
      status_text_ << snapshot.error_message;
      break;
  }
}

void PersonalizeScreen::FormatUidTo(pw::StringBuilder& out,
                                    const std::array<std::byte, 7>& uid,
                                    size_t size) {
  for (size_t i = 0; i < size; i++) {
    if (i > 0) {
      out << ':';
    }
    out.Format("%02X", static_cast<unsigned>(uid[i]));
  }
}

}  // namespace maco::personalize
