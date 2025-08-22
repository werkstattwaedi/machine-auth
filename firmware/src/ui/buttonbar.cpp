#include "buttonbar.h"

#include <algorithm>

#include "leds/led_controller.h"
#include "ui.h"

namespace oww::ui {

ButtonBar::ButtonBar(lv_obj_t* parent, std::shared_ptr<oww::state::State> state)
    : Component(state) {
  // Create the main container for the button bar
  // ButtonBar: 240×50px at bottom of screen
  root_ = lv_obj_create(parent);
  lv_obj_remove_style_all(root_);
  lv_obj_set_size(root_, 240, 50);
  lv_obj_set_align(root_, LV_ALIGN_BOTTOM_MID);
  lv_obj_set_flex_flow(root_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(root_, LV_FLEX_ALIGN_SPACE_BETWEEN,
                        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  // 10px margins on left/right: 240 - 20 = 220px for content
  lv_obj_set_style_pad_left(root_, 10, 0);
  lv_obj_set_style_pad_right(root_, 10, 0);

  // Create left button: 100×40px (as per mockup specifications)
  left_button_ = lv_btn_create(root_);
  lv_obj_set_size(left_button_, 100, 40);
  left_label_ = lv_label_create(left_button_);
  lv_obj_center(left_label_);
  lv_obj_add_flag(left_button_, LV_OBJ_FLAG_HIDDEN);  // Hidden by default

  // Create right button: 100×40px (as per mockup specifications)
  right_button_ = lv_btn_create(root_);
  lv_obj_set_size(right_button_, 100, 40);
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

  // Adjust flex alignment so a single visible button sits at the edge
  bool left_visible = definition->left_label != "";
  bool right_visible = definition->right_label != "";
  if (left_visible && right_visible) {
    lv_obj_set_flex_align(root_, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  } else if (right_visible && !left_visible) {
    lv_obj_set_flex_align(root_, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  } else if (left_visible && !right_visible) {
    lv_obj_set_flex_align(root_, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  }

  // Push colors to LED controller (override generic state)
  if (auto ui = UserInterface::instance().leds()) {
    using namespace oww::ui::leds;
    ButtonColors colors;
    // Map: TL, TR, BL, BR -> using LV button colors for now
    // Use brighter color when enabled, dim when disabled
    auto scale = [](lv_color32_t c, bool on) -> Color {
      uint8_t s = on ? 180 : 0;
      return Color::RGB((c.red * s) / 255, (c.green * s) / 255,
                        (c.blue * s) / 255);
    };
    colors.bottom_left =
        scale(definition->left_color, definition->left_enabled);
    colors.bottom_right =
        scale(definition->right_color, definition->right_enabled);
    colors.top_left =
        definition->down_enabled ? Color::WarmWhite(180) : Color::Off();
    colors.top_right =
        definition->up_enabled ? Color::WarmWhite(180) : Color::Off();
    ui->Buttons().SetColors(colors);
    EffectConfig fx;
    fx.type = EffectType::Solid;
    ui->Buttons().SetEffect(fx);
  }
}

void ButtonBar::ActivateButtons(std::shared_ptr<ButtonDefinition> definition) {
  if (definition) {
    definitions.push_back(definition);
  }
}

void ButtonBar::RemoveButtons(std::shared_ptr<ButtonDefinition> definition) {
  auto it = std::find(definitions.begin(), definitions.end(), definition);
  if (it != definitions.end()) {
    definitions.erase(it);
  }
}

}  // namespace oww::ui