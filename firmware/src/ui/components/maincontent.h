#pragma once

#include <memory>

#include "ui/components/buttonbar.h"
#include "ui/components/component.h"

namespace oww::ui::leds {
using LedEffect = hal::IHardware::LedEffect;
}

namespace oww::ui {

class MainContent : public Component {
 public:
  MainContent(lv_obj_t* parent, std::shared_ptr<state::IApplicationState> state,
              hal::IHardware* hardware = nullptr);
  virtual ~MainContent();

  virtual void Render() override;

  /** Called when this content becomes active */
  virtual void OnActivate();

  /** Called when this content becomes inactive */
  virtual void OnDeactivate();

  /** Returns the button definition for this content, or nullptr if none */
  virtual std::shared_ptr<ButtonDefinition> GetButtonDefinition() {
    return nullptr;
  }

  /** Returns the LED effect for this content, or nullptr if none */
  virtual leds::LedEffect GetLedEffect() { return nullptr; }
};

}  // namespace oww::ui
