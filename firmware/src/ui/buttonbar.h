#pragma once

#include "component.h"

namespace oww::ui {

class ButtonDefinition {
 public:
  String left_label;
  bool left_enabled;
  lv_color32_t left_color;

  String right_label;
  bool right_enabled;
  lv_color32_t right_color;

  bool up_enabled;
  bool down_enabled;
};

class ButtonBar : public Component {
 public:
  ButtonBar(lv_obj_t* parent, std::shared_ptr<oww::state::State> state);
  virtual ~ButtonBar();

  virtual void Render() override;

  /** Activates the ButtonDefinition, replacing a previous definition. */
  void ActivateButtons(std::shared_ptr<ButtonDefinition> definition);

  /** Removes the definition. If its the currently active one, restores the
   * previously active definiton. */
  void RemoveButtons(std::shared_ptr<ButtonDefinition> definition);

  // Expose LVGL button objects so the input driver can simulate touches at their centers
  inline lv_obj_t* GetLeftButtonObj() const { return left_button_; }
  inline lv_obj_t* GetRightButtonObj() const { return right_button_; }

 private:
  std::vector<std::shared_ptr<ButtonDefinition>> definitions;
  // Visible buttons
  lv_obj_t* left_button_;
  lv_obj_t* left_label_;
  lv_obj_t* right_button_;
  lv_obj_t* right_label_;
};

}  // namespace oww::ui
