#include "sessionstatus.h"

#include "../state/terminal/state.h"
#include "lvgl.h"

LV_IMG_DECLARE(tap_token);

namespace oww::ui {

SessionStatus::SessionStatus(lv_obj_t* parent,
                             std::shared_ptr<oww::state::State> state,
                             UserInterface* ui)
    : MainContent(parent, state, ui), last_state_id_(nullptr) {
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
  auto terminal_state = state_->GetTerminalState();

  if (terminal_state &&
      last_state_id_ != static_cast<void*>(terminal_state.get())) {
    UpdateForState(terminal_state);
    last_state_id_ = static_cast<void*>(terminal_state.get());
  }
}

void SessionStatus::UpdateForState(
    const std::shared_ptr<oww::state::terminal::State> terminal_state) {
  using namespace oww::state::terminal;

  std::visit(
      overloaded{
          [&](Idle state) {
            lv_label_set_text(status_text_, "Mit Token anmelden");
            lv_obj_set_style_bg_color(status_text_, lv_color_hex(0x17a2b8),
                                      LV_PART_MAIN);  // Cyan blue

            // Idle state buttons (single button on right)
            current_buttons_->left_label = "";  // No left button in idle state
            current_buttons_->left_enabled = false;
            current_buttons_->right_label = "A";  // Three dots button
            current_buttons_->right_enabled = true;
            current_buttons_->right_color =
                lv_color32_make(255, 193, 7, 255);  // Yellow/amber color
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          },
          [&](Detected state) {
            lv_label_set_text(status_text_, "Token erkannt");
            lv_obj_set_style_bg_color(status_text_, lv_color_hex(0x0066cc),
                                      LV_PART_MAIN);  // Blue

            // Detected state buttons (two buttons)
            current_buttons_->left_label = "B";  // Cancel/X button
            current_buttons_->left_enabled = true;
            current_buttons_->left_color =
                lv_color32_make(220, 53, 69, 255);  // Red
            current_buttons_->right_label = "C";    // Confirm/checkmark button
            current_buttons_->right_enabled = true;
            current_buttons_->right_color =
                lv_color32_make(40, 167, 69, 255);  // Green
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          },
          [&](Authenticated state) {
            lv_label_set_text(status_text_, "Authentifiziert");
            lv_obj_set_style_bg_color(status_text_, lv_color_hex(0x28a745),
                                      LV_PART_MAIN);  // Green

            // Authenticated state buttons
            current_buttons_->left_label = "D";  // Back button
            current_buttons_->left_enabled = true;
            current_buttons_->left_color =
                lv_color32_make(108, 117, 125, 255);  // Gray
            current_buttons_->right_label = "E";      // Forward/continue button
            current_buttons_->right_enabled = true;
            current_buttons_->right_color =
                lv_color32_make(40, 167, 69, 255);  // Green
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          },
          [&](StartSession state) {
            lv_label_set_text(status_text_, "Session gestartet");
            lv_obj_set_style_bg_color(status_text_, lv_color_hex(0x28a745),
                                      LV_PART_MAIN);  // Green

            // StartSession state buttons
            current_buttons_->left_label = "";
            current_buttons_->left_enabled = false;
            current_buttons_->right_label = "F";  // Pause/stop button
            current_buttons_->right_enabled = true;
            current_buttons_->right_color =
                lv_color32_make(255, 193, 7, 255);  // Yellow
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          },
          [&](Unknown state) {
            lv_label_set_text(status_text_, "Unbekannter Token");
            lv_obj_set_style_bg_color(status_text_, lv_color_hex(0xdc3545),
                                      LV_PART_MAIN);  // Red

            // Unknown state buttons
            current_buttons_->left_label = "G";  // Back button
            current_buttons_->left_enabled = true;
            current_buttons_->left_color =
                lv_color32_make(108, 117, 125, 255);  // Gray
            current_buttons_->right_label = "H";      // Help/question button
            current_buttons_->right_enabled = true;
            current_buttons_->right_color =
                lv_color32_make(255, 193, 7, 255);  // Yellow
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          },
          [&](Personalize state) {
            lv_label_set_text(status_text_, "Token wird personalisiert");
            lv_obj_set_style_bg_color(status_text_, lv_color_hex(0xffc107),
                                      LV_PART_MAIN);  // Yellow

            // Personalize state buttons
            current_buttons_->left_label = "";
            current_buttons_->left_enabled = false;
            current_buttons_->right_label = "I";  // Confirm button
            current_buttons_->right_enabled = true;
            current_buttons_->right_color =
                lv_color32_make(40, 167, 69, 255);  // Green
            current_buttons_->up_enabled = false;
            current_buttons_->down_enabled = false;
          }},
      *(terminal_state.get()));
}

std::shared_ptr<ButtonDefinition> SessionStatus::GetButtonDefinition() {
  return current_buttons_;
}

}  // namespace oww::ui