#pragma once

#include <functional>
#include <memory>
#include <string>

#include "ui/components/component.h"

// Forward declarations
namespace oww::hal {
class ILedEffect;
}

namespace oww::ui {

/**
 * @brief Configuration for status bar display
 *
 * Currently a placeholder for future enhancements (custom labels, colors, etc.)
 */
struct StatusBarSpec {
  // Future: custom_label, show_connection_status, background_color, etc.
};

/**
 * @brief Configuration for button bar display and behavior
 */
struct ButtonBarSpec {
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

/**
 * @brief Base class for all screens in the application
 *
 * A Screen is a full-screen UI component that can control its chrome
 * (status bar, button bar) and provide LED effects.
 */
class Screen : public Component {
 public:
  Screen(lv_obj_t* parent, std::shared_ptr<state::IApplicationState> state,
         hal::IHardware* hardware = nullptr);
  virtual ~Screen();

  virtual void Render() override;

  /** Called when this screen becomes active */
  virtual void OnActivate();

  /** Called when this screen becomes inactive */
  virtual void OnDeactivate();

  /** Returns status bar configuration, or nullptr to hide status bar */
  virtual std::shared_ptr<StatusBarSpec> GetStatusBarSpec() const {
    return std::make_shared<StatusBarSpec>();  // Default: show status bar
  }

  /** Returns button bar configuration, or nullptr to hide button bar */
  virtual std::shared_ptr<ButtonBarSpec> GetButtonBarSpec() const {
    return nullptr;  // Default: no button bar
  }

  /** Returns the LED effect for this screen, or nullptr if none */
  virtual std::shared_ptr<hal::ILedEffect> GetLedEffect() { return nullptr; }
};

}  // namespace oww::ui
