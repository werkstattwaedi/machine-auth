#include "ui/components/sessionstatus.h"

#include "common.h"
#include "lvgl.h"
#include "state/machine_state.h"
#include <chrono>

LV_IMG_DECLARE(tap_token);

namespace oww::ui {

SessionStatus::SessionStatus(lv_obj_t* parent,
                             std::shared_ptr<state::IApplicationState> state,
                             hal::IHardware* hardware)
    : MainContent(parent, state, hardware),
      last_state_id_(nullptr),
      user_label_(nullptr),
      duration_label_(nullptr),
      icon_(nullptr) {
  CreateNfcIconArea();
  CreateStatusText();

  // Initialize with empty button definition
  current_buttons_ = std::make_shared<ButtonDefinition>();
}

SessionStatus::~SessionStatus() {
  // Cleanup handled by parent destructor
}

void SessionStatus::CreateNfcIconArea() {
  // Main content area: 220 × 166px centered
  icon_container_ = lv_obj_create(root_);
  lv_obj_remove_style_all(icon_container_);
  lv_obj_set_size(icon_container_, 220, 166);
  lv_obj_center(icon_container_);
  lv_obj_set_style_bg_color(icon_container_, lv_color_hex(0xf8f9fa),
                            LV_PART_MAIN);
  lv_obj_set_style_bg_opa(icon_container_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_border_width(icon_container_, 1, LV_PART_MAIN);
  lv_obj_set_style_border_color(icon_container_, lv_color_hex(0xdee2e6),
                                LV_PART_MAIN);
  // lv_image_set_src(icon_container_, &tap_token);
}

void SessionStatus::CreateStatusText() {
  // Text area: 220 × 20px at bottom of main content area
  status_text_ = lv_label_create(icon_container_);
  lv_obj_set_size(status_text_, 220, 20);
  lv_obj_align(status_text_, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_style_text_font(status_text_, &roboto_12, LV_PART_MAIN);
  lv_obj_set_style_text_color(status_text_, lv_color_hex(0x333333),
                              LV_PART_MAIN);
  lv_obj_set_style_text_align(status_text_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
  lv_obj_set_style_bg_color(status_text_, lv_color_hex(0x17a2b8), LV_PART_MAIN);
  lv_obj_set_style_bg_opa(status_text_, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_text_color(status_text_, lv_color_hex(0xffffff),
                              LV_PART_MAIN);
  lv_label_set_text(status_text_, "TEXT TEXT TEXT TEXT");
}

void SessionStatus::OnActivate() {
  MainContent::OnActivate();
  // Force update when activated
  last_state_id_ = nullptr;
}

void SessionStatus::OnDeactivate() { MainContent::OnDeactivate(); }

void SessionStatus::Render() {
  auto machine_state = app_->GetMachineState();

  // Check if state changed (pointer comparison)
  if (machine_state.get() == last_state_id_) {
    // State hasn't changed, only update dynamic content (like duration)
    if (std::holds_alternative<state::machine::Active>(*machine_state)) {
      RenderActiveState(std::get<state::machine::Active>(*machine_state));
    }
    return;
  }

  // State changed - full re-render
  last_state_id_ = machine_state.get();

  // Dispatch to appropriate render method based on state
  std::visit(
      overloaded{[this](const state::machine::Idle&) { RenderIdleState(); },
                 [this](const state::machine::Active& active) {
                   RenderActiveState(active);
                 },
                 [this](const state::machine::Denied& denied) {
                   RenderDeniedState(denied);
                 }},
      *machine_state);

  UpdateButtonsForState();
}

std::shared_ptr<ButtonDefinition> SessionStatus::GetButtonDefinition() {
  return current_buttons_;
}

// ============================================================================
// State Rendering Methods
// ============================================================================

void SessionStatus::RenderIdleState() {
  // Reset background to neutral
  lv_obj_set_style_bg_color(icon_container_, lv_color_hex(0xf8f9fa),
                            LV_PART_MAIN);

  // Hide active state labels if they exist
  if (user_label_) {
    lv_obj_add_flag(user_label_, LV_OBJ_FLAG_HIDDEN);
  }
  if (duration_label_) {
    lv_obj_add_flag(duration_label_, LV_OBJ_FLAG_HIDDEN);
  }
  if (icon_) {
    lv_obj_del(icon_);
    icon_ = nullptr;
  }

  // Show/update status text
  lv_obj_clear_flag(status_text_, LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text(status_text_, "Mit Badge anmelden");
  lv_obj_set_style_bg_color(status_text_, lv_color_hex(0xf9c74f), LV_PART_MAIN);

  // TODO: Show NFC icon (tap_token image)
  // This requires the image to be available
}

void SessionStatus::RenderActiveState(const state::machine::Active& active) {
  // Green background
  lv_obj_set_style_bg_color(icon_container_, lv_color_hex(0x5cb85c),
                            LV_PART_MAIN);

  // Hide status text bar
  lv_obj_add_flag(status_text_, LV_OBJ_FLAG_HIDDEN);

  // Hide icon if present
  if (icon_) {
    lv_obj_del(icon_);
    icon_ = nullptr;
  }

  // Create or update user label
  if (!user_label_) {
    user_label_ = lv_label_create(icon_container_);
    lv_obj_set_width(user_label_, 200);
    lv_obj_set_style_text_font(user_label_, &roboto_24, LV_PART_MAIN);
    lv_obj_set_style_text_color(user_label_, lv_color_hex(0xffffff),
                                LV_PART_MAIN);
    lv_obj_set_style_text_align(user_label_, LV_TEXT_ALIGN_CENTER,
                                LV_PART_MAIN);
    lv_obj_align(user_label_, LV_ALIGN_CENTER, 0, -20);
  }
  lv_obj_clear_flag(user_label_, LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text(user_label_, active.user_label.c_str());

  // Create or update duration label
  if (!duration_label_) {
    duration_label_ = lv_label_create(icon_container_);
    lv_obj_set_width(duration_label_, 200);
    lv_obj_set_style_text_font(duration_label_, &roboto_24, LV_PART_MAIN);
    lv_obj_set_style_text_color(duration_label_, lv_color_hex(0xffffff),
                                LV_PART_MAIN);
    lv_obj_set_style_text_align(duration_label_, LV_TEXT_ALIGN_CENTER,
                                LV_PART_MAIN);
    lv_obj_align(duration_label_, LV_ALIGN_CENTER, 0, 20);
  }
  lv_obj_clear_flag(duration_label_, LV_OBJ_FLAG_HIDDEN);

  // Calculate and format duration
  auto now = std::chrono::system_clock::now();
  auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
      now - active.start_time);
  std::string duration_text = FormatDuration(elapsed);
  lv_label_set_text(duration_label_, duration_text.c_str());
}

void SessionStatus::RenderDeniedState(const state::machine::Denied& denied) {
  // Red background
  lv_obj_set_style_bg_color(icon_container_, lv_color_hex(0xd9534f),
                            LV_PART_MAIN);

  // Hide active state labels
  if (user_label_) {
    lv_obj_add_flag(user_label_, LV_OBJ_FLAG_HIDDEN);
  }
  if (duration_label_) {
    lv_obj_add_flag(duration_label_, LV_OBJ_FLAG_HIDDEN);
  }

  // Create or update X icon
  // TODO: Create actual X icon - for now use label
  if (!icon_) {
    icon_ = lv_label_create(icon_container_);
    lv_obj_set_width(icon_, 200);
    lv_obj_set_style_text_font(icon_, &roboto_24, LV_PART_MAIN);
    lv_obj_set_style_text_color(icon_, lv_color_hex(0xffffff), LV_PART_MAIN);
    lv_obj_set_style_text_align(icon_, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_align(icon_, LV_ALIGN_CENTER, 0, -20);
    lv_label_set_text(icon_, "✗");  // Unicode X mark
  }
  lv_obj_clear_flag(icon_, LV_OBJ_FLAG_HIDDEN);

  // Show status text with denial message
  lv_obj_clear_flag(status_text_, LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text(status_text_, denied.message.c_str());
  lv_obj_set_style_bg_color(status_text_, lv_color_hex(0xd9534f), LV_PART_MAIN);
}

void SessionStatus::UpdateButtonsForState() {
  auto machine_state = app_->GetMachineState();

  std::visit(
      overloaded{
          [this](const state::machine::Idle&) {
            // No buttons in idle state
            current_buttons_->left_enabled = false;
            current_buttons_->right_enabled = false;
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          },
          [this](const state::machine::Active&) {
            // "Stopp" button on left side (yellow)
            current_buttons_->left_enabled = true;
            current_buttons_->left_label = "Stopp";
            current_buttons_->left_color = lv_color32_make(0xf9, 0xc7, 0x4f, 0xff);
            current_buttons_->left_callback = [this]() {
              app_->RequestManualCheckOut();
            };
            current_buttons_->right_enabled = false;
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          },
          [this](const state::machine::Denied&) {
            // "OK" button to dismiss (or auto-dismiss after timeout)
            current_buttons_->left_enabled = true;
            current_buttons_->left_label = "OK";
            current_buttons_->left_color = lv_color32_make(0xf9, 0xc7, 0x4f, 0xff);
            current_buttons_->left_callback = [this]() {
              // Denial state should auto-clear, but allow manual dismiss
              // This would need to be handled by application logic
            };
            current_buttons_->right_enabled = false;
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          }},
      *machine_state);
}

std::string SessionStatus::FormatDuration(std::chrono::seconds elapsed) {
  auto minutes = std::chrono::duration_cast<std::chrono::minutes>(elapsed);
  int total_minutes = minutes.count();

  // Round to nearest 5 minutes
  int rounded_minutes = ((total_minutes + 2) / 5) * 5;

  // Format as "X min"
  return std::to_string(rounded_minutes) + " min";
}

}  // namespace oww::ui