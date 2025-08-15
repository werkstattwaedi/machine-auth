#include "buttonbar.h"

#include <algorithm>

namespace oww::ui {

ButtonBar::ButtonBar(lv_obj_t* parent, std::shared_ptr<oww::state::State> state)
    : Component(state) {
  // Create the main container for the button bar
  root_ = lv_obj_create(parent);
  lv_obj_remove_style_all(root_);
  lv_obj_set_size(root_, LV_PCT(100), 60);
  lv_obj_set_align(root_, LV_ALIGN_BOTTOM_MID);
  lv_obj_set_flex_flow(root_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(root_, LV_FLEX_ALIGN_SPACE_BETWEEN,
                        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_left(root_, 20, 0);
  lv_obj_set_style_pad_right(root_, 20, 0);

  // Create left button
  left_button_ = lv_btn_create(root_);
  lv_obj_set_size(left_button_, 120, 40);
  left_label_ = lv_label_create(left_button_);
  lv_obj_center(left_label_);
  lv_obj_add_flag(left_button_, LV_OBJ_FLAG_HIDDEN);  // Hidden by default

  // Create right button
  right_button_ = lv_btn_create(root_);
  lv_obj_set_size(right_button_, 120, 40);
  right_label_ = lv_label_create(right_button_);
  lv_obj_center(right_label_);
  lv_obj_add_flag(right_button_, LV_OBJ_FLAG_HIDDEN);  // Hidden by default
}

ButtonBar::~ButtonBar() { lv_obj_delete(root_); }

void ButtonBar::Render() {
  if (definitions.empty()) {
    // No active definition - hide all buttons
    lv_obj_add_flag(left_button_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(right_button_, LV_OBJ_FLAG_HIDDEN);
    return;
  }

  // Get the currently active definition (top of stack)
  auto definition = definitions.back();

  // Handle left button
  if (definition->left_label == "") {
    lv_obj_add_flag(left_button_, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_clear_flag(left_button_, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(left_label_, definition->left_label.c_str());

    // Set button color
    lv_color_t color =
        lv_color_make(definition->left_color.red, definition->left_color.green,
                      definition->left_color.blue);
    lv_obj_set_style_bg_color(left_button_, color, LV_PART_MAIN);

    // Set enabled/disabled state
    if (definition->left_enabled) {
      lv_obj_clear_state(left_button_, LV_STATE_DISABLED);
    } else {
      lv_obj_add_state(left_button_, LV_STATE_DISABLED);
    }
  }

  // Handle right button
  if (definition->right_label == "") {
    lv_obj_add_flag(right_button_, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_clear_flag(right_button_, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(right_label_, definition->right_label.c_str());

    // Set button color
    lv_color_t color = lv_color_make(definition->right_color.red,
                                     definition->right_color.green,
                                     definition->right_color.blue);
    lv_obj_set_style_bg_color(right_button_, color, LV_PART_MAIN);

    // Set enabled/disabled state
    if (definition->right_enabled) {
      lv_obj_clear_state(right_button_, LV_STATE_DISABLED);
    } else {
      lv_obj_add_state(right_button_, LV_STATE_DISABLED);
    }
  }
}

void ButtonBar::ActivateButtons(std::shared_ptr<ButtonDefinition> definition) {
  definitions.push_back(definition);
  Render();
}

void ButtonBar::RemoveButtons(std::shared_ptr<ButtonDefinition> definition) {
  auto it = std::find(definitions.begin(), definitions.end(), definition);
  if (it != definitions.end()) {
    definitions.erase(it);
  }
}

}  // namespace oww::ui