// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/terminal_ui/screens/confirmation_overlay.h"

#include <algorithm>

#include "maco_firmware/modules/led_animator/button_effects.h"
#include "maco_firmware/modules/terminal_ui/theme.h"
#include "pw_assert/check.h"

namespace maco::terminal_ui {

namespace {

constexpr int kContentPadding = 16;
constexpr int kUsableWidth = 208;  // 240 - 2*16px padding

// Card wraps the question label and extends past the screen bottom so the
// bottom rounded corners are clipped — only the top corners are visible.
// The button bar (on lv_layer_top()) visually sits inside the card.
constexpr int kCardRadius = 12;
constexpr int kCardY = 200;
constexpr int kScreenHeight = 320;
constexpr int kCardHeight = kScreenHeight - kCardY + kCardRadius;

constexpr uint32_t kCardBgColor = theme::kColorGreen;
constexpr int kStatusBarHeight = 40;

}  // namespace

ConfirmationOverlay::ConfirmationOverlay(ActionCallback& action_callback)
    : action_callback_(action_callback) {}

void ConfirmationOverlay::Create(lv_obj_t* parent, lv_group_t* group) {
  group_ = group;

  // Scrim: full-screen dark overlay
  scrim_ = lv_obj_create(parent);
  lv_obj_remove_style_all(scrim_);
  lv_obj_set_size(scrim_, LV_PCT(100), LV_PCT(100));
  lv_obj_set_style_bg_color(scrim_, lv_color_black(), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(scrim_, LV_OPA_30, LV_PART_MAIN);
  lv_obj_add_flag(scrim_, LV_OBJ_FLAG_HIDDEN);

  // Top scrim: dims the status bar on lv_layer_top()
  top_scrim_ = lv_obj_create(lv_layer_top());
  lv_obj_remove_style_all(top_scrim_);
  lv_obj_set_size(top_scrim_, LV_PCT(100), kStatusBarHeight);
  lv_obj_align(top_scrim_, LV_ALIGN_TOP_LEFT, 0, 0);
  lv_obj_set_style_bg_color(top_scrim_, lv_color_black(), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(top_scrim_, LV_OPA_30, LV_PART_MAIN);
  lv_obj_add_flag(top_scrim_, LV_OBJ_FLAG_HIDDEN);

  // Card: extends past screen bottom to clip bottom corners
  card_ = lv_obj_create(parent);
  lv_obj_remove_style_all(card_);
  lv_obj_set_size(card_, LV_PCT(100), kCardHeight);
  lv_obj_align(card_, LV_ALIGN_TOP_LEFT, 0, kCardY);
  lv_obj_set_style_bg_color(card_, lv_color_hex(kCardBgColor), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(card_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_radius(card_, kCardRadius, LV_PART_MAIN);
  lv_obj_set_style_pad_all(card_, kContentPadding, LV_PART_MAIN);
  lv_obj_clear_flag(card_, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(card_, LV_OBJ_FLAG_HIDDEN);

  // Question label inside card
  question_label_ = lv_label_create(card_);
  lv_label_set_text(question_label_, "");
  lv_obj_set_style_text_font(question_label_, &roboto_24, LV_PART_MAIN);
  lv_obj_set_style_text_color(question_label_, lv_color_white(), LV_PART_MAIN);
  lv_obj_set_width(question_label_, kUsableWidth);
  lv_label_set_long_mode(question_label_, LV_LABEL_LONG_DOT);

  // Invisible button to capture OK key press for confirm
  confirm_btn_ = lv_button_create(parent);
  lv_obj_set_size(confirm_btn_, 0, 0);
  lv_obj_add_flag(confirm_btn_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_event_cb(
      confirm_btn_,
      [](lv_event_t* e) {
        auto* cb = static_cast<ActionCallback*>(lv_event_get_user_data(e));
        if (*cb) {
          (*cb)(UiAction::kConfirm);
        }
      },
      LV_EVENT_CLICKED,
      &action_callback_);
  if (group_) {
    lv_group_add_obj(group_, confirm_btn_);
    // Bubble events up to the screen root for ESC handling.
    // Stop before parent (the screen) — matches Screen::AddToGroup().
    for (lv_obj_t* obj = confirm_btn_; obj && obj != parent;
         obj = lv_obj_get_parent(obj)) {
      lv_obj_add_flag(obj, LV_OBJ_FLAG_EVENT_BUBBLE);
    }
  }
}

ConfirmationOverlay::~ConfirmationOverlay() {
  // top_scrim_ lives on lv_layer_top(), not the screen, so it won't be
  // auto-deleted when the screen is destroyed. Clean up defensively.
  if (top_scrim_) {
    lv_obj_delete(top_scrim_);
  }
}

void ConfirmationOverlay::Destroy() {
  // top_scrim_ lives on lv_layer_top() — must be explicitly deleted.
  // All other widgets are children of lv_screen_ and will be auto-deleted
  // when AppShell destroys the screen.
  if (top_scrim_) {
    lv_obj_delete(top_scrim_);
    top_scrim_ = nullptr;
  }
  scrim_ = nullptr;
  card_ = nullptr;
  question_label_ = nullptr;
  confirm_btn_ = nullptr;
  group_ = nullptr;
  visible_ = false;
}

void ConfirmationOverlay::Show(PendingType type,
                               std::string_view takeover_user_label) {
  PW_DCHECK_NOTNULL(scrim_, "Create() must be called before Show()");

  pending_type_ = type;
  visible_ = true;

  // Set question text
  if (type == PendingType::kTakeover) {
    lv_label_set_text_fmt(question_label_, "%.*s anmelden?",
                          static_cast<int>(takeover_user_label.size()),
                          takeover_user_label.data());
  } else {
    lv_label_set_text(question_label_, "Beenden?");
  }

  lv_obj_remove_flag(scrim_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_remove_flag(top_scrim_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_remove_flag(card_, LV_OBJ_FLAG_HIDDEN);
  lv_obj_remove_flag(confirm_btn_, LV_OBJ_FLAG_HIDDEN);

  if (group_) {
    lv_group_focus_obj(confirm_btn_);
  }
}

void ConfirmationOverlay::SetTakeoverLabel(
    std::string_view takeover_user_label) {
  lv_label_set_text_fmt(question_label_, "%.*s anmelden?",
                        static_cast<int>(takeover_user_label.size()),
                        takeover_user_label.data());
}

void ConfirmationOverlay::Hide() {
  visible_ = false;
  if (scrim_) {
    lv_obj_add_flag(scrim_, LV_OBJ_FLAG_HIDDEN);
  }
  if (top_scrim_) {
    lv_obj_add_flag(top_scrim_, LV_OBJ_FLAG_HIDDEN);
  }
  if (card_) {
    lv_obj_add_flag(card_, LV_OBJ_FLAG_HIDDEN);
  }
  if (confirm_btn_) {
    lv_obj_add_flag(confirm_btn_, LV_OBJ_FLAG_HIDDEN);
  }
}

bool ConfirmationOverlay::IsVisible() const { return visible_; }

void ConfirmationOverlay::UpdateProgress(
    pw::chrono::SystemClock::time_point pending_since,
    pw::chrono::SystemClock::time_point pending_deadline,
    bool tag_present) {
  cached_pending_since_ = pending_since;
  cached_pending_deadline_ = pending_deadline;
  cached_tag_present_ = tag_present;
}

uint8_t ConfirmationOverlay::ComputeProgress() const {
  auto now = pw::chrono::SystemClock::now();
  auto total = cached_pending_deadline_ - cached_pending_since_;
  auto elapsed = now - cached_pending_since_;
  int total_ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(total).count();
  int elapsed_ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
  if (total_ms <= 0) return 1;
  return static_cast<uint8_t>(
      std::max(1, std::min(100, elapsed_ms * 100 / total_ms)));
}

ui::ButtonConfig ConfirmationOverlay::GetButtonConfig() const {
  uint8_t progress = ComputeProgress();

  if (pending_type_ == PendingType::kStop) {
    // Stop always fills "Ja" (no badge-remove cancel)
    return {
        .ok = {.label = "Ja",
               .led_effect = led_animator::SolidButton(
                   led::RgbwColor::FromRgb(theme::kColorBtnGreen)),
               .bg_color = theme::kColorBtnGreen,
               .text_color = 0xFFFFFF,
               .fill_progress = progress},
        .cancel = {.label = "Nein",
                   .led_effect = led_animator::SolidButton(
                       led::RgbwColor::FromRgb(theme::kColorBtnRed)),
                   .bg_color = theme::kColorBtnRed,
                   .text_color = 0xFFFFFF},
    };
  }

  // Checkout and takeover: progress depends on tag presence
  if (cached_tag_present_) {
    return {
        .ok = {.label = "Ja",
               .led_effect = led_animator::SolidButton(
                   led::RgbwColor::FromRgb(theme::kColorBtnGreen)),
               .bg_color = theme::kColorBtnGreen,
               .text_color = 0xFFFFFF,
               .fill_progress = progress},
        .cancel = {.label = "Nein",
                   .led_effect = led_animator::SolidButton(
                       led::RgbwColor::FromRgb(theme::kColorBtnRed)),
                   .bg_color = theme::kColorBtnRed,
                   .text_color = 0xFFFFFF},
    };
  }
  // Badge removed: Nein fills (cancel countdown)
  return {
      .ok = {.label = "Ja",
             .led_effect = led_animator::SolidButton(
                 led::RgbwColor::FromRgb(theme::kColorBtnGreen)),
             .bg_color = theme::kColorBtnGreen,
             .text_color = 0xFFFFFF},
      .cancel = {.label = "Nein",
                 .led_effect = led_animator::SolidButton(
                     led::RgbwColor::FromRgb(theme::kColorBtnRed)),
                 .bg_color = theme::kColorBtnRed,
                 .text_color = 0xFFFFFF,
                 .fill_progress = progress},
  };
}

}  // namespace maco::terminal_ui
