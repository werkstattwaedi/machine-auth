#pragma once

#include "ui/components/screen.h"
#include "state/system_state.h"
#include "hal/hardware_interface.h"
#include <memory>
#include <optional>

// Forward declarations
namespace oww::hal {
class ILedEffect;
}
namespace oww::ui::leds {
class BootWaveEffect;
}

namespace oww::ui {

class SplashScreen : public Screen {
 public:
  SplashScreen(lv_obj_t* parent, std::shared_ptr<state::IApplicationState> app,
               hal::IHardware* hardware = nullptr);
  virtual ~SplashScreen();

  virtual void Render() override;

  /** Returns status bar spec (nullptr = hidden during splash) */
  std::shared_ptr<StatusBarSpec> GetStatusBarSpec() const override {
    return nullptr;  // Hide status bar during boot
  }

  /** Returns button bar spec (nullptr = hidden during splash) */
  std::shared_ptr<ButtonBarSpec> GetButtonBarSpec() const override {
    return nullptr;  // Hide button bar during boot
  }

  /** Returns the LED effect for the current boot phase */
  std::shared_ptr<hal::ILedEffect> GetLedEffect() override;

 private:
  // Hardware access
  hal::IHardware* hardware_;

  // UI elements
  lv_obj_t* image_;
  lv_obj_t* progress_label_;
  lv_obj_t* progress_bar_;

  // Track last set phase to create effect when phase changes
  std::optional<state::system::BootPhase> last_phase_;
  std::shared_ptr<leds::BootWaveEffect> current_effect_;

  // Helper methods
  const char* GetPhaseMessage(state::system::BootPhase phase);
  hal::LedColor GetPhaseColor(state::system::BootPhase phase);
};

}  // namespace oww::ui
