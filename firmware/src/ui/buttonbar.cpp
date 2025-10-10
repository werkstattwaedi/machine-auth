#include "buttonbar.h"

#include <algorithm>

#include "leds/led_controller.h"
#include "ui.h"

namespace oww::ui {

Logger buttonbar_logger("app.ui.buttonbar");

ButtonBar::ButtonBar(lv_obj_t* parent,
                     std::shared_ptr<oww::logic::Application> state)
    : Component(state) {
  // Create the main container for the button bar
  // ButtonBar: 240×50px at bottom of screen, no padding
  root_ = lv_obj_create(parent);
  lv_obj_remove_style_all(root_);
  lv_obj_set_size(root_, 240, 50);
  lv_obj_set_align(root_, LV_ALIGN_BOTTOM_MID);
  lv_obj_set_style_pad_all(root_, 0, 0);

  // Create left button: Align with HW button from x=0 to ~x=45
  // Based on image: left HW button covers roughly first 45px
  left_button_ = lv_btn_create(root_);
  lv_obj_set_size(left_button_, 90, 50);
  lv_obj_set_pos(left_button_, 0, 0);
  left_label_ = lv_label_create(left_button_);
  lv_obj_center(left_label_);
  lv_obj_add_flag(left_button_, LV_OBJ_FLAG_HIDDEN);  // Hidden by default
  lv_obj_add_event_cb(left_button_, left_button_event_cb, LV_EVENT_CLICKED,
                      this);

  // Create right button: Align with HW button from ~x=195 to x=240
  // Based on image: right HW button covers roughly last 45px
  right_button_ = lv_btn_create(root_);
  lv_obj_set_size(right_button_, 90, 50);
  lv_obj_set_pos(right_button_, 150, 0);
  right_label_ = lv_label_create(right_button_);
  lv_obj_center(right_label_);
  lv_obj_add_flag(right_button_, LV_OBJ_FLAG_HIDDEN);  // Hidden by default
  lv_obj_add_event_cb(right_button_, right_button_event_cb, LV_EVENT_CLICKED,
                      this);

  // Create invisible up button in the gap: x=45 to x=120
  up_button_ = lv_btn_create(root_);
  lv_obj_set_size(up_button_, 10, 50);
  lv_obj_set_pos(up_button_, 110, 0);
  // Make invisible but still clickable
  lv_obj_set_style_bg_opa(up_button_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_border_opa(up_button_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_shadow_opa(up_button_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_add_event_cb(up_button_, up_button_event_cb, LV_EVENT_CLICKED, this);

  // Create invisible down button in the gap: x=120 to x=195
  down_button_ = lv_btn_create(root_);
  lv_obj_set_size(down_button_, 10, 50);
  lv_obj_set_pos(down_button_, 120, 0);
  // Make invisible but still clickable
  lv_obj_set_style_bg_opa(down_button_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_border_opa(down_button_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_set_style_shadow_opa(down_button_, LV_OPA_TRANSP, LV_PART_MAIN);
  lv_obj_add_event_cb(down_button_, down_button_event_cb, LV_EVENT_CLICKED,
                      this);
}

ButtonBar::~ButtonBar() { lv_obj_delete(root_); }

void ButtonBar::Render() {
  if (definitions.empty()) {
    // No active definition - hide all buttons
    lv_obj_add_flag(left_button_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(right_button_, LV_OBJ_FLAG_HIDDEN);
    current_definition_ = nullptr;
    return;
  }

  // Get the currently active definition (top of stack)
  auto definition = definitions.back();
  current_definition_ = definition;  // Store for callbacks

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

void ButtonBar::left_button_event_cb(lv_event_t* e) {
  buttonbar_logger.info("ButtonBar::left clicked");
  ButtonBar* buttonbar = static_cast<ButtonBar*>(lv_event_get_user_data(e));
  if (buttonbar && buttonbar->current_definition_ &&
      buttonbar->current_definition_->left_callback) {
    buttonbar->current_definition_->left_callback();
  }
}

void ButtonBar::right_button_event_cb(lv_event_t* e) {
  buttonbar_logger.info("ButtonBar::right clicked");
  ButtonBar* buttonbar = static_cast<ButtonBar*>(lv_event_get_user_data(e));
  if (buttonbar && buttonbar->current_definition_ &&
      buttonbar->current_definition_->right_callback) {
    buttonbar->current_definition_->right_callback();
  }
}

void ButtonBar::up_button_event_cb(lv_event_t* e) {
  buttonbar_logger.info("ButtonBar::up clicked");
  ButtonBar* buttonbar = static_cast<ButtonBar*>(lv_event_get_user_data(e));
  if (buttonbar && buttonbar->current_definition_ &&
      buttonbar->current_definition_->up_callback) {
    buttonbar->current_definition_->up_callback();
  }
}

void ButtonBar::down_button_event_cb(lv_event_t* e) {
  buttonbar_logger.info("ButtonBar::down clicked");
  ButtonBar* buttonbar = static_cast<ButtonBar*>(lv_event_get_user_data(e));
  if (buttonbar && buttonbar->current_definition_ &&
      buttonbar->current_definition_->down_callback) {
    buttonbar->current_definition_->down_callback();
  }
}

}  // namespace oww::ui