#include "ui/components/sessionstatus.h"

#include "lvgl.h"

LV_IMG_DECLARE(tap_token);

namespace oww::ui {

SessionStatus::SessionStatus(lv_obj_t* parent,
                             std::shared_ptr<oww::logic::Application> state,
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
  // TODO: Implement rendering based on new state system (SessionState, MachineState)
}

void SessionStatus::UpdateForState() {
  // TODO: Update UI elements based on new state system
}

std::shared_ptr<ButtonDefinition> SessionStatus::GetButtonDefinition() {
  return current_buttons_;
}

}  // namespace oww::ui