#pragma once

#include <functional>
#include <string>

#include "ui/components/component.h"

namespace oww::ui {

class ButtonDefinition {
 public:
  std::string left_label;
  bool left_enabled;
  lv_color32_t left_color;
  std::function<void()> left_callback;

  std::string right_label;
  bool right_enabled;
  lv_color32_t right_color;
  std::function<void()> right_callback;

  bool up_enabled;
  bool down_enabled;
  std::function<void()> up_callback;
  std::function<void()> down_callback;
};

// Touch points based on actual hardware button positions from image
// Left HW button: roughly x=0 to x=45, center at x=22
// Right HW button: roughly x=195 to x=240, center at x=217
// Up/Down buttons in the gap between them
inline constexpr lv_point_t top_left_touch_point{115,
                                                 300};  // Left HW button center
inline constexpr lv_point_t top_right_touch_point{
    125, 300};  // Right HW button center
inline constexpr lv_point_t bottom_left_touch_point{
    45, 300};  // Left HW button center
inline constexpr lv_point_t bottom_right_touch_point{
    195, 300};  // Right HW button center

class ButtonBar : public Component {
 public:
  ButtonBar(lv_obj_t* parent, std::shared_ptr<state::IApplicationState> state,
            hal::IHardware* hardware);
  virtual ~ButtonBar();

  virtual void Render() override;

  /** Activates the ButtonDefinition, replacing a previous definition. */
  void ActivateButtons(std::shared_ptr<ButtonDefinition> definition);

  /** Removes the definition. If its the currently active one, restores the
   * previously active definiton. */
  void RemoveButtons(std::shared_ptr<ButtonDefinition> definition);

 private:
  std::vector<std::shared_ptr<ButtonDefinition>> definitions;
  // Visible buttons
  lv_obj_t* left_button_;
  lv_obj_t* left_label_;
  lv_obj_t* right_button_;
  lv_obj_t* right_label_;

  // Invisible buttons for hardware up/down
  lv_obj_t* up_button_;    // Invisible button on the right side for up
  lv_obj_t* down_button_;  // Invisible button on the left side for down

  // LVGL event callbacks
  static void left_button_event_cb(lv_event_t* e);
  static void right_button_event_cb(lv_event_t* e);
  static void up_button_event_cb(lv_event_t* e);
  static void down_button_event_cb(lv_event_t* e);

  // Current active definition for callbacks
  std::shared_ptr<ButtonDefinition> current_definition_;
};

}  // namespace oww::ui
