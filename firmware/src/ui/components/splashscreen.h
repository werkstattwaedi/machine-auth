#pragma once

#include "ui/components/component.h"
#include "state/system_state.h"
#include "hal/hardware_interface.h"
#include "ui/leds/led_effect.h"
#include <optional>

namespace oww::ui {

class SplashScreen : public Component {
 public:
  SplashScreen(std::shared_ptr<state::IApplicationState> app,
               hal::IHardware* hardware = nullptr);
  virtual ~SplashScreen();

  virtual void Render() override;

  /** Returns the LED effect for the current boot phase */
  leds::LedEffect GetLedEffect();

 private:
  // Hardware access
  hal::IHardware* hardware_;

  // UI elements
  lv_obj_t* image_;
  lv_obj_t* progress_label_;
  lv_obj_t* progress_bar_;

  // Track last set phase to create effect when phase changes
  std::optional<state::system::BootPhase> last_phase_;
  leds::LedEffect current_effect_;

  // Helper methods
  const char* GetPhaseMessage(state::system::BootPhase phase);
  hal::LedColor GetPhaseColor(state::system::BootPhase phase);
};

}  // namespace oww::ui
